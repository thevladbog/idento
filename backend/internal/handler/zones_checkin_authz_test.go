package handler

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestZoneCheckIn_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/checkin", body, caller.String(), "admin")

	_ = h.ZoneCheckIn(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign-tenant zone check-in, got %d", rec.Code)
	}
}

// TestZoneCheckIn_AllowsAssignedStaff proves that a "staff" caller who IS
// assigned to the zone passes the BACKEND-SEC-05 authz gate.
//
// To prove this we need the staff-assignment list to contain the *exact*
// caller ID the handler parses out of the JWT claims, but newAuthedContext
// generates a random UserID internally and doesn't expose it. We use option
// (a) from the task: newAuthedContextWithUserID, a small variant added to
// testsupport_test.go that accepts an explicit userID so the assignment can
// be built to reference that same ID. This directly proves the match
// (assignment.UserID == callerID) drives the allow decision, rather than
// just inferring it indirectly.
//
// The fake's GetAttendeeByCode returns an error so the request fails at the
// *next* step (attendee lookup, -> 404 "Attendee not found") instead of
// panicking on an unset fakeStore field. Reaching that 404 (not the gate's
// 403 "Not assigned to this zone") is the proof the staff gate was passed.
func TestZoneCheckIn_AllowsAssignedStaff(t *testing.T) {
	ownerTenant := uuid.New()
	callerID := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
		getZoneStaffAssign: func(zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{
				{UserID: callerID, ZoneID: zoneID},
			}, nil
		},
		getAttendeeByCode: func(_ uuid.UUID, _ string) (*models.Attendee, error) {
			return nil, errors.New("attendee lookup reached: staff gate was passed")
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/zones/checkin", body, ownerTenant.String(), callerID, "staff")

	_ = h.ZoneCheckIn(c)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("assigned staff should not be forbidden at the authz gate, got 403: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "Not assigned") {
		t.Fatalf("assigned staff hit the 'Not assigned' gate, response: %s", rec.Body.String())
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected to progress past the gate to attendee lookup (404), got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestZoneCheckIn_ForbidsUnassignedStaff proves that a "staff" caller who is
// NOT in the zone's staff-assignment list is denied by the authz gate.
func TestZoneCheckIn_ForbidsUnassignedStaff(t *testing.T) {
	ownerTenant := uuid.New()
	callerID := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
		getZoneStaffAssign: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/zones/checkin", body, ownerTenant.String(), callerID, "staff")

	_ = h.ZoneCheckIn(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unassigned staff, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Not assigned") {
		t.Fatalf("expected 'Not assigned' error message, got: %s", rec.Body.String())
	}
}

// TestZoneCheckIn_DeniesOnStaffAssignmentStoreError proves that a store
// error while loading staff assignments is treated as a deny, not a
// fail-open allow: it must not reach 200/checked-in and must not be
// mistaken for the 403 "Not assigned" gate either (it's a distinct 500
// internal error).
func TestZoneCheckIn_DeniesOnStaffAssignmentStoreError(t *testing.T) {
	ownerTenant := uuid.New()
	callerID := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
		getZoneStaffAssign: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return nil, errors.New("db unavailable")
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/zones/checkin", body, ownerTenant.String(), callerID, "staff")

	_ = h.ZoneCheckIn(c)

	if rec.Code == http.StatusOK {
		t.Fatalf("a store error on assignment lookup must never allow check-in, got 200: %s", rec.Body.String())
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on assignment store error, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestZoneCheckIn_AllowsAdminOfOwningTenant proves the admin/manager bypass
// still works for a same-tenant admin even when the zone has no staff
// assignments at all (the assignment lookup should never even be
// consulted for admin/manager roles).
func TestZoneCheckIn_AllowsAdminOfOwningTenant(t *testing.T) {
	ownerTenant := uuid.New()
	callerID := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
		getZoneStaffAssign: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{}, nil
		},
		getAttendeeByCode: func(_ uuid.UUID, _ string) (*models.Attendee, error) {
			return nil, errors.New("attendee lookup reached: admin bypass was taken")
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/zones/checkin", body, ownerTenant.String(), callerID, "admin")

	_ = h.ZoneCheckIn(c)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("admin of owning tenant should not be forbidden at the authz gate, got 403: %s", rec.Body.String())
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected to progress past the gate to attendee lookup (404), got %d: %s", rec.Code, rec.Body.String())
	}
}
