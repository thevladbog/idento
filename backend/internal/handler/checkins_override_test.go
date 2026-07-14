package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TestCreateCheckinOverride_MissingClaimsReturns401 proves a request with no
// "user" in context (e.g. corrupted middleware state) gets a clean 401
// instead of panicking on the raw claims type assertion.
func TestCreateCheckinOverride_MissingClaimsReturns401(t *testing.T) {
	eventID := uuid.New()
	h := &Handler{Store: &fakeStore{}}
	e := echo.New()
	body := `{"attendee_id":"` + uuid.New().String() + `","context":"already_checked"}`
	c, rec := newUnauthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/override", body)
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing claims, got %d", rec.Code)
	}
}

func TestCreateCheckinOverride_RejectsInvalidContext(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"attendee_id":"` + uuid.New().String() + `","context":"bogus"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/override", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateCheckinOverride(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid context, got %d", rec.Code)
	}
}

func TestCreateCheckinOverride_RecordsStaffFromJWT(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	var recordedStaff uuid.UUID
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		createCheckinOverride: func(o *models.CheckinOverride) error {
			recordedStaff = o.StaffUserID
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	staffID := uuid.New()
	body := `{"attendee_id":"` + attendeeID.String() + `","context":"already_checked"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/override", body, tenantID.String(), staffID, "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if recordedStaff != staffID {
		t.Fatalf("expected override to record staff %s, got %s", staffID, recordedStaff)
	}
}
