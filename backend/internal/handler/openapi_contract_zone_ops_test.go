package handler

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func contractAttendeeZoneAccess(attendeeID, zoneID uuid.UUID) *models.AttendeeZoneAccess {
	now := time.Now()
	return &models.AttendeeZoneAccess{
		ID:         uuid.New(),
		AttendeeID: attendeeID,
		ZoneID:     zoneID,
		Allowed:    true,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

func contractStaffAssignment(userID, zoneID uuid.UUID) *models.StaffZoneAssignment {
	assignedBy := uuid.New()
	return &models.StaffZoneAssignment{
		ID:         uuid.New(),
		UserID:     userID,
		ZoneID:     zoneID,
		AssignedAt: time.Now(),
		AssignedBy: &assignedBy,
	}
}

func contractZoneCheckin(attendeeID, zoneID uuid.UUID) *models.ZoneCheckin {
	return &models.ZoneCheckin{
		ID:          uuid.New(),
		AttendeeID:  attendeeID,
		ZoneID:      zoneID,
		CheckedInAt: time.Now(),
		EventDay:    time.Now().Truncate(24 * time.Hour),
	}
}

// TestContractCreateAttendeeZoneAccess covers POST
// /api/attendees/{attendee_id}/zone-access: the 201 happy path, the two
// distinct-shape-but-same-schema 404 causes (attendee missing/store-failure
// masked as "Attendee not found" — this handler loads via the plain,
// non-tenant-scoped Store.GetAttendeeByID, same pattern as GET
// /api/attendees/{id}/qr — versus the attendee's event being foreign-tenant,
// "Event not found"), and the two 500 causes.
func TestContractCreateAttendeeZoneAccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	zoneID := uuid.New()
	h := New(&fakeStore{
		getAttendeeByID:          func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:             func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAttendeeZoneAccess: func(*models.AttendeeZoneAccess) error { return nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/zone-access"
	body := `{"zone_id":"` + zoneID.String() + `","allowed":true}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := h.CreateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("CreateAttendeeZoneAccess: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: attendee does not exist (GetAttendeeByID returns nil, nil — same
	// masked shape as a store failure loading it).
	hMissing := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hMissing.CreateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("CreateAttendeeZoneAccess (attendee missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: attendee exists, but its event belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodPost, path, body, uuid.New().String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := h.CreateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("CreateAttendeeZoneAccess (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: a raw (non-*httpError) store error from GetEventByIDForTenant
	// propagates out of requireEventOwnership and hits writeErr's fallback
	// branch ({"error": "Internal error"}) — the attendee lookup above
	// already succeeded, so this is NOT masked as 404.
	hOwnershipFail := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hOwnershipFail.CreateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("CreateAttendeeZoneAccess (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.CreateAttendeeZoneAccess itself fails.
	hCreateFail := New(&fakeStore{
		getAttendeeByID:          func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:             func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAttendeeZoneAccess: func(*models.AttendeeZoneAccess) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hCreateFail.CreateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("CreateAttendeeZoneAccess (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractGetAttendeeZoneAccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	access := contractAttendeeZoneAccess(attendee.ID, uuid.New())
	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeZoneAccessList: func(uuid.UUID) ([]*models.AttendeeZoneAccess, error) {
			return []*models.AttendeeZoneAccess{access}, nil
		},
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/zone-access"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := h.GetAttendeeZoneAccess(c); err != nil {
		t.Fatalf("GetAttendeeZoneAccess: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: attendee does not exist.
	hMissing := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hMissing.GetAttendeeZoneAccess(c); err != nil {
		t.Fatalf("GetAttendeeZoneAccess (attendee missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetAttendeeZoneAccessList itself fails.
	hFetchFail := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeZoneAccessList: func(uuid.UUID) ([]*models.AttendeeZoneAccess, error) {
			return nil, errors.New("query failed")
		},
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-access")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hFetchFail.GetAttendeeZoneAccess(c); err != nil {
		t.Fatalf("GetAttendeeZoneAccess (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractUpdateAttendeeZoneAccess exercises the three-deep ownership
// chain unique to this operation: GetAttendeeZoneAccessByID (which masks its
// OWN lookup failure as 404 "Access override not found", the same masking
// class as requireZoneOwnership's zone lookup, applied here to a third
// entity type) feeding into requireZoneOwnership on the EXISTING record's
// zone_id (not the request body's).
func TestContractUpdateAttendeeZoneAccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	access := contractAttendeeZoneAccess(uuid.New(), zone.ID)
	h := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return access, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateAttendeeZoneAccess:  func(*models.AttendeeZoneAccess) error { return nil },
	})
	e := echo.New()
	path := "/api/attendee-zone-access/" + access.ID.String()
	body := `{"allowed":false,"notes":"revoked"}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := h.UpdateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("UpdateAttendeeZoneAccess: %v", err)
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 404: the override itself does not exist (also covers a
	// GetAttendeeZoneAccessByID store failure, masked identically).
	hMissing := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := hMissing.UpdateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("UpdateAttendeeZoneAccess (override missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 404: the override exists, but its zone does not (requireZoneOwnership's
	// own "Zone not found").
	hZoneMissing := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return access, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := hZoneMissing.UpdateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("UpdateAttendeeZoneAccess (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 404: the override and zone exist, but the zone's event belongs to a
	// different tenant ("Event not found", nested requireEventOwnership).
	c, rec = newAuthedContext(e, http.MethodPut, path, body, uuid.New().String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := h.UpdateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("UpdateAttendeeZoneAccess (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 500: a raw store error resolving the zone's event ownership propagates
	// out of the nested requireEventOwnership call inside requireZoneOwnership.
	hOwnershipFail := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return access, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := hOwnershipFail.UpdateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("UpdateAttendeeZoneAccess (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 500: Store.UpdateAttendeeZoneAccess itself fails.
	hUpdateFail := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return access, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateAttendeeZoneAccess:  func(*models.AttendeeZoneAccess) error { return errors.New("update failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := hUpdateFail.UpdateAttendeeZoneAccess(c); err != nil {
		t.Fatalf("UpdateAttendeeZoneAccess (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

func TestContractDeleteAttendeeZoneAccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	access := contractAttendeeZoneAccess(uuid.New(), zone.ID)
	h := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return access, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		deleteAttendeeZoneAccess:  func(uuid.UUID) error { return nil },
	})
	e := echo.New()
	path := "/api/attendee-zone-access/" + access.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := h.DeleteAttendeeZoneAccess(c); err != nil {
		t.Fatalf("DeleteAttendeeZoneAccess: %v", err)
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 404: the override itself does not exist.
	hMissing := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := hMissing.DeleteAttendeeZoneAccess(c); err != nil {
		t.Fatalf("DeleteAttendeeZoneAccess (override missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: Store.DeleteAttendeeZoneAccess itself fails.
	hDeleteFail := New(&fakeStore{
		getAttendeeZoneAccessByID: func(uuid.UUID) (*models.AttendeeZoneAccess, error) { return access, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		deleteAttendeeZoneAccess:  func(uuid.UUID) error { return errors.New("delete failed") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendee-zone-access/:id")
	c.SetParamNames("id")
	c.SetParamValues(access.ID.String())
	if err := hDeleteFail.DeleteAttendeeZoneAccess(c); err != nil {
		t.Fatalf("DeleteAttendeeZoneAccess (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)
}

func TestContractAssignStaffToZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	staffUserID := uuid.New()
	h := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		assignStaffToZone: func(assignment *models.StaffZoneAssignment) error {
			assignment.ID = uuid.New()
			assignment.AssignedAt = time.Now()
			return nil
		},
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/staff"
	body := `{"user_id":"` + staffUserID.String() + `"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.AssignStaffToZone(c); err != nil {
		t.Fatalf("AssignStaffToZone: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: zone does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.AssignStaffToZone(c); err != nil {
		t.Fatalf("AssignStaffToZone (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: a raw store error resolving the zone's event ownership propagates
	// out of the nested requireEventOwnership call inside requireZoneOwnership.
	hOwnershipFail := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hOwnershipFail.AssignStaffToZone(c); err != nil {
		t.Fatalf("AssignStaffToZone (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.AssignStaffToZone itself fails.
	hAssignFail := New(&fakeStore{
		getEventZoneByID:  func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:      func(uuid.UUID) (*models.Event, error) { return event, nil },
		assignStaffToZone: func(*models.StaffZoneAssignment) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hAssignFail.AssignStaffToZone(c); err != nil {
		t.Fatalf("AssignStaffToZone (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractGetZoneStaff(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	assignment := contractStaffAssignment(uuid.New(), zone.ID)
	h := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getZoneStaffAssign: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{assignment}, nil
		},
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/staff"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetZoneStaff(c); err != nil {
		t.Fatalf("GetZoneStaff: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: zone does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.GetZoneStaff(c); err != nil {
		t.Fatalf("GetZoneStaff (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetZoneStaffAssignments itself fails.
	hFetchFail := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getZoneStaffAssign: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return nil, errors.New("query failed")
		},
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hFetchFail.GetZoneStaff(c); err != nil {
		t.Fatalf("GetZoneStaff (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

func TestContractRemoveStaffFromZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	userID := uuid.New()
	h := New(&fakeStore{
		getEventZoneByID:    func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		removeStaffFromZone: func(uuid.UUID, uuid.UUID) error { return nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/staff/" + userID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff/:user_id")
	c.SetParamNames("zone_id", "user_id")
	c.SetParamValues(zone.ID.String(), userID.String())
	if err := h.RemoveStaffFromZone(c); err != nil {
		t.Fatalf("RemoveStaffFromZone: %v", err)
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 400: user_id is not a UUID.
	badPath := "/api/zones/" + zone.ID.String() + "/staff/not-a-uuid"
	c, rec = newAuthedContext(e, http.MethodDelete, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff/:user_id")
	c.SetParamNames("zone_id", "user_id")
	c.SetParamValues(zone.ID.String(), "not-a-uuid")
	if err := h.RemoveStaffFromZone(c); err != nil {
		t.Fatalf("RemoveStaffFromZone (bad user_id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, badPath, rec)

	// 404: zone does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff/:user_id")
	c.SetParamNames("zone_id", "user_id")
	c.SetParamValues(zone.ID.String(), userID.String())
	if err := hMissing.RemoveStaffFromZone(c); err != nil {
		t.Fatalf("RemoveStaffFromZone (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: Store.RemoveStaffFromZone itself fails.
	hRemoveFail := New(&fakeStore{
		getEventZoneByID:    func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		removeStaffFromZone: func(uuid.UUID, uuid.UUID) error { return errors.New("delete failed") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/staff/:user_id")
	c.SetParamNames("zone_id", "user_id")
	c.SetParamValues(zone.ID.String(), userID.String())
	if err := hRemoveFail.RemoveStaffFromZone(c); err != nil {
		t.Fatalf("RemoveStaffFromZone (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)
}

// TestContractGetUserZoneAssignments covers a genuinely different
// authorization pattern from the three known ownership helpers
// (requireEventOwnership/requireAttendeeOwnership/requireZoneOwnership):
// GetUserZoneAssignments checks the target user's role in the CALLER's
// active tenant directly via Store.GetUserTenantRole, inline in the
// handler — not one of the shared authz.go helpers. A store failure there
// is a genuine 500 (unlike requireZoneOwnership's own-lookup masking).
func TestContractGetUserZoneAssignments(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	assignment := contractStaffAssignment(userID, uuid.New())
	h := New(&fakeStore{
		getUserTenantRole: func(uuid.UUID, uuid.UUID) (string, error) { return "staff", nil },
		getStaffZoneAssignments: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{assignment}, nil
		},
	})
	e := echo.New()
	path := "/api/users/" + userID.String() + "/zones"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/users/:user_id/zones")
	c.SetParamNames("user_id")
	c.SetParamValues(userID.String())
	if err := h.GetUserZoneAssignments(c); err != nil {
		t.Fatalf("GetUserZoneAssignments: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: the target user has no role in the caller's active tenant
	// (covers both "does not exist" and "different tenant" uniformly).
	hNotMember := New(&fakeStore{
		getUserTenantRole: func(uuid.UUID, uuid.UUID) (string, error) { return "", nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/users/:user_id/zones")
	c.SetParamNames("user_id")
	c.SetParamValues(userID.String())
	if err := hNotMember.GetUserZoneAssignments(c); err != nil {
		t.Fatalf("GetUserZoneAssignments (not a member): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: GetUserTenantRole itself fails — surfaced honestly as a 500, NOT
	// folded into the 404 above (unlike requireZoneOwnership's own lookup).
	hRoleFail := New(&fakeStore{
		getUserTenantRole: func(uuid.UUID, uuid.UUID) (string, error) { return "", errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/users/:user_id/zones")
	c.SetParamNames("user_id")
	c.SetParamValues(userID.String())
	if err := hRoleFail.GetUserZoneAssignments(c); err != nil {
		t.Fatalf("GetUserZoneAssignments (role check failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetStaffZoneAssignments itself fails, after membership passed.
	hAssignFail := New(&fakeStore{
		getUserTenantRole: func(uuid.UUID, uuid.UUID) (string, error) { return "staff", nil },
		getStaffZoneAssignments: func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return nil, errors.New("query failed")
		},
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/users/:user_id/zones")
	c.SetParamNames("user_id")
	c.SetParamValues(userID.String())
	if err := hAssignFail.GetUserZoneAssignments(c); err != nil {
		t.Fatalf("GetUserZoneAssignments (assignments store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

func TestContractGetZoneCheckins(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	checkin := contractZoneCheckin(uuid.New(), zone.ID)
	h := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getZoneCheckins: func(uuid.UUID, time.Time) ([]*models.ZoneCheckin, error) {
			return []*models.ZoneCheckin{checkin}, nil
		},
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/checkins"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/checkins")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetZoneCheckins(c); err != nil {
		t.Fatalf("GetZoneCheckins: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 200: explicit ?date= query param.
	datedPath := path + "?date=2026-07-14"
	c, rec = newAuthedContext(e, http.MethodGet, datedPath, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/checkins")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetZoneCheckins(c); err != nil {
		t.Fatalf("GetZoneCheckins (dated): %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 400: date does not parse as YYYY-MM-DD.
	badPath := path + "?date=not-a-date"
	c, rec = newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/checkins")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetZoneCheckins(c); err != nil {
		t.Fatalf("GetZoneCheckins (bad date): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: zone does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/checkins")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.GetZoneCheckins(c); err != nil {
		t.Fatalf("GetZoneCheckins (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetZoneCheckins itself fails.
	hFetchFail := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getZoneCheckins: func(uuid.UUID, time.Time) ([]*models.ZoneCheckin, error) {
			return nil, errors.New("query failed")
		},
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/checkins")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hFetchFail.GetZoneCheckins(c); err != nil {
		t.Fatalf("GetZoneCheckins (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractGetAttendeeZoneHistory also proves the per-entry zone-lookup
// enrichment is best-effort: a GetEventZoneByID failure while building one
// history entry is logged and skipped, NOT surfaced as a request error — the
// checkin is still returned, just with zone_name/zone_type left blank.
func TestContractGetAttendeeZoneHistory(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	zone := contractZone(event.ID)
	checkin := contractZoneCheckin(attendee.ID, zone.ID)
	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeZoneCheckins: func(uuid.UUID) ([]*models.ZoneCheckin, error) {
			return []*models.ZoneCheckin{checkin}, nil
		},
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/zone-history"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-history")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := h.GetAttendeeZoneHistory(c); err != nil {
		t.Fatalf("GetAttendeeZoneHistory: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 200: the per-entry zone lookup fails — the checkin is still included,
	// with zone_name/zone_type left blank (best-effort enrichment).
	hZoneLookupFails := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeZoneCheckins: func(uuid.UUID) ([]*models.ZoneCheckin, error) {
			return []*models.ZoneCheckin{checkin}, nil
		},
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, errors.New("zone lookup failed") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-history")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hZoneLookupFails.GetAttendeeZoneHistory(c); err != nil {
		t.Fatalf("GetAttendeeZoneHistory (zone enrichment failure): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 even when zone enrichment fails, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: attendee does not exist.
	hMissing := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-history")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hMissing.GetAttendeeZoneHistory(c); err != nil {
		t.Fatalf("GetAttendeeZoneHistory (attendee missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetAttendeeZoneCheckins itself fails.
	hFetchFail := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeZoneCheckins: func(uuid.UUID) ([]*models.ZoneCheckin, error) {
			return nil, errors.New("query failed")
		},
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/zone-history")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hFetchFail.GetAttendeeZoneHistory(c); err != nil {
		t.Fatalf("GetAttendeeZoneHistory (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// zoneCheckInBaseStore returns a fakeStore configured for the happy path of
// POST /api/zones/checkin: an active zone with no time constraints and no
// registration requirement, owned by tenantID, plus a usage-log no-op.
func zoneCheckInBaseStore(event *models.Event, zone *models.EventZone) *fakeStore {
	return &fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		logUsage:         func(*models.UsageLog) error { return nil },
	}
}

func TestContractZoneCheckIn(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	attendee := contractAttendee(event.ID)
	e := echo.New()
	path := "/api/zones/checkin"
	body := `{"attendee_code":"` + attendee.Code + `","zone_id":"` + zone.ID.String() + `","event_day":"2026-07-14T00:00:00Z"}`

	// 200: fresh check-in ("Check-in successful").
	fs := zoneCheckInBaseStore(event, zone)
	fs.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return attendee, nil }
	fs.checkZoneAccess = func(uuid.UUID, uuid.UUID) (bool, string, error) { return true, "Access granted (default)", nil }
	fs.checkAttendeeZoneCheckin = func(uuid.UUID, uuid.UUID, time.Time) (*models.ZoneCheckin, error) { return nil, nil }
	fs.createZoneCheckin = func(*models.ZoneCheckin) error { return nil }
	h := New(fs)
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := h.ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 200: already checked in today ("Already checked in").
	fsAlready := zoneCheckInBaseStore(event, zone)
	fsAlready.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return attendee, nil }
	fsAlready.checkZoneAccess = func(uuid.UUID, uuid.UUID) (bool, string, error) { return true, "Access granted (default)", nil }
	fsAlready.checkAttendeeZoneCheckin = func(uuid.UUID, uuid.UUID, time.Time) (*models.ZoneCheckin, error) {
		return contractZoneCheckin(attendee.ID, zone.ID), nil
	}
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsAlready).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (already checked in): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: malformed body.
	c, rec = newAuthedContext(e, http.MethodPost, path, `not json`, tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(&fakeStore{}).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (bad body): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: zone does not exist.
	hZoneMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := hZoneMissing.ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: attendee_code does not match any attendee in the zone's event.
	fsNoAttendee := zoneCheckInBaseStore(event, zone)
	fsNoAttendee.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return nil, nil }
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsNoAttendee).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (attendee missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractZoneCheckInBusinessDenials covers the 403 business-logic
// denial branches, all rendered as ZoneCheckInResponse{success:false} —
// distinct from the pre-handler tenant_suspended 403 (plain Error shape,
// not exercised here since these tests call the handler directly, bypassing
// TenantGate; see internal/middleware/tenant_gate_test.go for that).
func TestContractZoneCheckInBusinessDenials(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	e := echo.New()
	path := "/api/zones/checkin"
	body := func(zoneID uuid.UUID) string {
		return `{"attendee_code":"` + attendee.Code + `","zone_id":"` + zoneID.String() + `","event_day":"2026-07-14T00:00:00Z"}`
	}

	// 403: staff caller not assigned to the zone.
	zone := contractZone(event.ID)
	fsUnassigned := zoneCheckInBaseStore(event, zone)
	fsUnassigned.getZoneStaffAssign = func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
		return []*models.StaffZoneAssignment{}, nil
	}
	callerID := uuid.New()
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, path, body(zone.ID), tenantID.String(), callerID, "staff")
	c.SetPath("/api/zones/checkin")
	if err := New(fsUnassigned).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (unassigned staff): %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 403: zone is not active.
	inactiveZone := contractZone(event.ID)
	inactiveZone.IsActive = false
	fsInactive := zoneCheckInBaseStore(event, inactiveZone)
	fsInactive.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return attendee, nil }
	c, rec = newAuthedContext(e, http.MethodPost, path, body(inactiveZone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsInactive).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (zone inactive): %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 403: non-registration zone requires prior registration, attendee
	// hasn't registered yet.
	requiresRegZone := contractZone(event.ID)
	requiresRegZone.RequiresRegistration = true
	unregisteredAttendee := contractAttendee(event.ID)
	fsMustRegister := zoneCheckInBaseStore(event, requiresRegZone)
	fsMustRegister.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return unregisteredAttendee, nil }
	c, rec = newAuthedContext(e, http.MethodPost, path, body(requiresRegZone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsMustRegister).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (must register first): %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 403: CheckZoneAccess denies (category rule / individual override).
	deniedZone := contractZone(event.ID)
	fsDenied := zoneCheckInBaseStore(event, deniedZone)
	fsDenied.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return attendee, nil }
	fsDenied.checkZoneAccess = func(uuid.UUID, uuid.UUID) (bool, string, error) {
		return false, "Access denied (individual override)", nil
	}
	c, rec = newAuthedContext(e, http.MethodPost, path, body(deniedZone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsDenied).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (access denied): %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractZoneCheckInFailures covers the 500 branches. Every 500 in this
// handler renders as ZoneCheckInResponse (success:false), unlike every other
// zones.go handler which uses the plain Error shape for its 500s — because
// ZoneCheckIn wraps every return after Bind in that response shape.
func TestContractZoneCheckInFailures(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	e := echo.New()
	path := "/api/zones/checkin"
	body := func(zoneID uuid.UUID) string {
		return `{"attendee_code":"` + attendee.Code + `","zone_id":"` + zoneID.String() + `","event_day":"2026-07-14T00:00:00Z"}`
	}

	// 500: a raw store error resolving the zone's event ownership propagates
	// out of the nested requireEventOwnership call inside requireZoneOwnership.
	zone := contractZone(event.ID)
	fsOwnershipFail := &fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	}
	c, rec := newAuthedContext(e, http.MethodPost, path, body(zone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsOwnershipFail).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: fetching zone staff assignments fails for a non-admin/manager caller.
	fsAssignFail := zoneCheckInBaseStore(event, zone)
	fsAssignFail.getZoneStaffAssign = func(uuid.UUID) ([]*models.StaffZoneAssignment, error) {
		return nil, errors.New("db unavailable")
	}
	callerID := uuid.New()
	c, rec = newAuthedContextWithUserID(e, http.MethodPost, path, body(zone.ID), tenantID.String(), callerID, "staff")
	c.SetPath("/api/zones/checkin")
	if err := New(fsAssignFail).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (staff assignment lookup failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: auto-registration on a registration zone fails to persist.
	regZone := contractZone(event.ID)
	regZone.IsRegistrationZone = true
	unregisteredAttendee := contractAttendee(event.ID)
	fsRegisterFail := zoneCheckInBaseStore(event, regZone)
	fsRegisterFail.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return unregisteredAttendee, nil }
	fsRegisterFail.updateAttendee = func(*models.Attendee) error { return errors.New("update failed") }
	c, rec = newAuthedContext(e, http.MethodPost, path, body(regZone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsRegisterFail).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (auto-registration failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: checking for an existing check-in fails.
	checkZone := contractZone(event.ID)
	fsCheckFail := zoneCheckInBaseStore(event, checkZone)
	fsCheckFail.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return attendee, nil }
	fsCheckFail.checkZoneAccess = func(uuid.UUID, uuid.UUID) (bool, string, error) { return true, "Access granted (default)", nil }
	fsCheckFail.checkAttendeeZoneCheckin = func(uuid.UUID, uuid.UUID, time.Time) (*models.ZoneCheckin, error) {
		return nil, errors.New("query failed")
	}
	c, rec = newAuthedContext(e, http.MethodPost, path, body(checkZone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsCheckFail).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (check-existing failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: persisting the new check-in fails.
	createZone := contractZone(event.ID)
	fsCreateFail := zoneCheckInBaseStore(event, createZone)
	fsCreateFail.getAttendeeByCode = func(uuid.UUID, string) (*models.Attendee, error) { return attendee, nil }
	fsCreateFail.checkZoneAccess = func(uuid.UUID, uuid.UUID) (bool, string, error) { return true, "Access granted (default)", nil }
	fsCreateFail.checkAttendeeZoneCheckin = func(uuid.UUID, uuid.UUID, time.Time) (*models.ZoneCheckin, error) { return nil, nil }
	fsCreateFail.createZoneCheckin = func(*models.ZoneCheckin) error { return errors.New("insert failed") }
	c, rec = newAuthedContext(e, http.MethodPost, path, body(createZone.ID), tenantID.String(), "admin")
	c.SetPath("/api/zones/checkin")
	if err := New(fsCreateFail).ZoneCheckIn(c); err != nil {
		t.Fatalf("ZoneCheckIn (create-checkin failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractCreateCheckinOverride covers POST
// /api/events/{event_id}/checkins/override: the 201 happy path (with and
// without zone_id), the 400 invalid-context branch, the three same-shape
// 404 causes (event/attendee/zone), and the two 500 causes.
func TestContractCreateCheckinOverride(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:          func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:       func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventZoneByID:      func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		createCheckinOverride: func(*models.CheckinOverride) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/checkins/override"

	// 201: no zone_id in the body.
	body := `{"attendee_id":"` + attendee.ID.String() + `","context":"already_checked"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 201: zone_id given and valid.
	bodyWithZone := `{"attendee_id":"` + attendee.ID.String() + `","context":"no_access","zone_id":"` + zone.ID.String() + `"}`
	c, rec = newAuthedContext(e, http.MethodPost, path, bodyWithZone, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (with zone_id): %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: context is not one of the three valid values.
	badBody := `{"attendee_id":"` + attendee.ID.String() + `","context":"bogus"}`
	c, rec = newAuthedContext(e, http.MethodPost, path, badBody, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (bad context): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: event does not exist / foreign tenant.
	c, rec = newAuthedContext(e, http.MethodPost, path, body, uuid.New().String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: attendee does not exist / belongs to a different event.
	hAttendeeMissing := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hAttendeeMissing.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (attendee missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: zone_id given, but the zone does not exist / belongs to a
	// different event.
	hZoneMissing := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:  func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, bodyWithZone, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hZoneMissing.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: a raw store error resolving event ownership propagates out of
	// requireEventOwnership (via writeErr's fallback branch).
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.CreateCheckinOverride itself fails.
	hCreateFail := New(&fakeStore{
		getEventByID:          func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:       func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		createCheckinOverride: func(*models.CheckinOverride) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/checkins/override")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hCreateFail.CreateCheckinOverride(c); err != nil {
		t.Fatalf("CreateCheckinOverride (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}
