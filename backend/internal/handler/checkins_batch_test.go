package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestBatchCheckin_RejectsAttendeeFromDifferentEvent(t *testing.T) {
	eventID := uuid.New()
	otherEventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	clientUUID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: otherEventID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `[{"client_uuid":"` + clientUUID.String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"}]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with per-item errors, got %d", rec.Code)
	}
	var results []models.BatchCheckinResult
	if err := jsonUnmarshalBody(rec, &results); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(results) != 1 || results[0].Status != "error" {
		t.Fatalf("expected one error result for cross-event attendee, got %+v", results)
	}
}

func TestBatchCheckin_DedupsRepeatedClientUUID(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	clientUUID := uuid.New()
	callCount := 0
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			callCount++
			if callCount == 1 {
				return store.BatchCheckinCreated, nil
			}
			return store.BatchCheckinDuplicateClientUUID, nil // replay reports duplicate
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `[{"client_uuid":"` + clientUUID.String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"}]`

	c1, rec1 := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c1.SetParamNames("event_id")
	c1.SetParamValues(eventID.String())
	_ = h.BatchCheckin(c1)
	var r1 []models.BatchCheckinResult
	_ = jsonUnmarshalBody(rec1, &r1)
	if r1[0].Status != "created" {
		t.Fatalf("expected first submission 'created', got %q", r1[0].Status)
	}

	c2, rec2 := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c2.SetParamNames("event_id")
	c2.SetParamValues(eventID.String())
	_ = h.BatchCheckin(c2)
	var r2 []models.BatchCheckinResult
	_ = jsonUnmarshalBody(rec2, &r2)
	if r2[0].Status != "already_exists" {
		t.Fatalf("expected retried submission 'already_exists', got %q", r2[0].Status)
	}
}

// TestBatchCheckin_AlreadyCheckedInMapsToAlreadyExists is the handler half of
// the "already checked in by a different device/client_uuid" gap: a brand
// new client_uuid (i.e. NOT a replay — ApplyBatchCheckin never even reaches
// its batch_checkin_log dedup path in this scenario) whose attendee turns out
// to already be checked in must still surface as "already_exists" in the
// response, not "created". Before the fix, ApplyBatchCheckin folded this case
// into applied=true because the new client_uuid had no conflict in
// batch_checkin_log, so the handler reported "created" — indistinguishable
// from a genuine first-time check-in.
func TestBatchCheckin_AlreadyCheckedInMapsToAlreadyExists(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	clientUUID := uuid.New() // brand new client_uuid, never submitted before
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			// Simulates: attendee.CheckinStatus was already true (checked in
			// by a different device earlier), so ApplyBatchCheckin made no
			// write and reports BatchCheckinAlreadyCheckedIn.
			return store.BatchCheckinAlreadyCheckedIn, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `[{"client_uuid":"` + clientUUID.String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":2,"kind":"checkin"}]`

	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var results []models.BatchCheckinResult
	if err := jsonUnmarshalBody(rec, &results); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(results) != 1 || results[0].Status != "already_exists" {
		t.Fatalf("expected 'already_exists' for an already-checked-in attendee, got %+v", results)
	}
}
