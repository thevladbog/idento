package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- Template A: event_id-based handlers ---

func TestGetEventZones_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetEventZones(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestCreateEventZone_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/", `{"name":"VIP"}`, caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.CreateEventZone(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetAvailableZones_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetAvailableZones(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// --- Template B: zone_id / :id (zone) based handlers ---

func zoneOwnedByFakeStore(owner, eventID uuid.UUID) *fakeStore {
	return &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
}

func TestGetEventZone_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(zoneID.String())

	_ = h.GetEventZone(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestUpdateEventZone_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/", `{"name":"x"}`, caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(zoneID.String())

	_ = h.UpdateEventZone(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestDeleteEventZone_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodDelete, "/", "", caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(zoneID.String())

	_ = h.DeleteEventZone(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestCreateZoneAccessRule_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/", `{"category":"vip","allowed":true}`, caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.CreateZoneAccessRule(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetZoneAccessRules_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.GetZoneAccessRules(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestBulkUpdateZoneAccessRules_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/", `[]`, caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.BulkUpdateZoneAccessRules(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestAssignStaffToZone_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/", `{"user_id":"`+uuid.New().String()+`"}`, caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.AssignStaffToZone(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetZoneStaff_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.GetZoneStaff(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestRemoveStaffFromZone_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodDelete, "/", "", caller.String(), "admin")
	c.SetParamNames("zone_id", "user_id")
	c.SetParamValues(zoneID.String(), uuid.New().String())

	_ = h.RemoveStaffFromZone(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetZoneCheckins_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.GetZoneCheckins(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetZoneDays_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())

	_ = h.GetZoneDays(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetZoneQRCode_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	h := &Handler{Store: zoneOwnedByFakeStore(owner, eventID)}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(zoneID.String())

	_ = h.GetZoneQRCode(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// --- Attendee-based handlers: resolved via GetAttendeeByID -> requireEventOwnership ---

func TestCreateAttendeeZoneAccess_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	attendeeID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/", `{"zone_id":"`+uuid.New().String()+`","allowed":true}`, caller.String(), "admin")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendeeID.String())

	_ = h.CreateAttendeeZoneAccess(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetAttendeeZoneAccess_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	attendeeID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendeeID.String())

	_ = h.GetAttendeeZoneAccess(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetAttendeeZoneHistory_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	attendeeID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendeeID.String())

	_ = h.GetAttendeeZoneHistory(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// --- AttendeeZoneAccess-record-ID-based handlers: resolved via
// GetAttendeeZoneAccessByID -> requireZoneOwnership ---

func TestUpdateAttendeeZoneAccess_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	accessID := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getAttendeeZoneAccessByID: func(id uuid.UUID) (*models.AttendeeZoneAccess, error) {
			return &models.AttendeeZoneAccess{ID: id, ZoneID: zoneID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/", `{"allowed":false}`, caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(accessID.String())

	_ = h.UpdateAttendeeZoneAccess(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestDeleteAttendeeZoneAccess_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	accessID := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getAttendeeZoneAccessByID: func(id uuid.UUID) (*models.AttendeeZoneAccess, error) {
			return &models.AttendeeZoneAccess{ID: id, ZoneID: zoneID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodDelete, "/", "", caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(accessID.String())

	_ = h.DeleteAttendeeZoneAccess(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// --- GetUserZoneAssignments: user_id must belong to the caller's ACTIVE
// tenant (user_tenants membership), not the target's home users.tenant_id
// (P1.9). Cross-tenant/unknown targets are a uniform 404 — no 403 oracle.

func TestGetUserZoneAssignments_ForbidsForeignTenantUser(t *testing.T) {
	callerTenant := uuid.New()
	targetUserID := uuid.New()
	fs := &fakeStore{
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			// Target is not a member of the caller's active tenant.
			return "", nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", callerTenant.String(), "admin")
	c.SetParamNames("user_id")
	c.SetParamValues(targetUserID.String())

	_ = h.GetUserZoneAssignments(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 (uniform not-found for non-member), got %d", rec.Code)
	}
}

func TestGetUserZoneAssignments_AllowsSameTenantUser(t *testing.T) {
	tenant := uuid.New()
	targetUserID := uuid.New()
	fs := &fakeStore{
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			if userID == targetUserID && tenantID == tenant {
				return "staff", nil
			}
			return "", nil
		},
		getStaffZoneAssignments: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", tenant.String(), "admin")
	c.SetParamNames("user_id")
	c.SetParamValues(targetUserID.String())

	_ = h.GetUserZoneAssignments(c)
	if rec.Code == http.StatusForbidden {
		t.Fatalf("expected same-tenant member lookup to be allowed, got 403: %s", rec.Body.String())
	}
}

func TestGetUserZoneAssignments_UserNotFound(t *testing.T) {
	tenant := uuid.New()
	targetUserID := uuid.New()
	fs := &fakeStore{
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			return "", nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", tenant.String(), "admin")
	c.SetParamNames("user_id")
	c.SetParamValues(targetUserID.String())

	_ = h.GetUserZoneAssignments(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown user, got %d", rec.Code)
	}
}
