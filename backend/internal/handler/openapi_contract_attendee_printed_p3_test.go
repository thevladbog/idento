package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TestContractMarkAttendeePrinted_IncrementsSequentially exercises the happy
// path twice in a row against the SAME attendee — proving the handler
// forwards the store's returned count as-is (not re-deriving/echoing a
// locally-tracked value) and that two calls in sequence each report a
// freshly incremented count (0 -> 1 -> 2), matching the SQL's
// `printed_count + 1 ... RETURNING printed_count` semantics from
// pg_store_attendee_printed_test.go.
func TestContractMarkAttendeePrinted_IncrementsSequentially(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	count := 0
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		incrementAttendeePrintedCount: func(attendeeID uuid.UUID) (int, error) {
			if attendeeID != attendee.ID {
				t.Fatalf("IncrementAttendeePrintedCount called with %s, want %s", attendeeID, attendee.ID)
			}
			count++
			return count, nil
		},
	})

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/printed"

	for i, wantCount := range []int{1, 2} {
		c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
		c.SetPath("/api/attendees/:attendee_id/printed")
		c.SetParamNames("attendee_id")
		c.SetParamValues(attendee.ID.String())
		if err := h.MarkAttendeePrinted(c); err != nil {
			t.Fatalf("call %d: MarkAttendeePrinted: %v", i+1, err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("call %d: want 200, got %d, body=%s", i+1, rec.Code, rec.Body.String())
		}
		var got struct {
			PrintedCount int `json:"printed_count"`
		}
		if err := jsonUnmarshalBody(rec, &got); err != nil {
			t.Fatalf("call %d: unmarshal: %v", i+1, err)
		}
		if got.PrintedCount != wantCount {
			t.Fatalf("call %d: printed_count = %d, want %d", i+1, got.PrintedCount, wantCount)
		}
		validateResponse(t, http.MethodPost, path, rec)
	}
}

// TestContractMarkAttendeePrinted_ForeignTenant404s covers requireAttendeeOwnership's
// 404-masking: an attendee that exists but belongs to a different tenant
// must come back identical (404, no existence oracle) to a missing one.
func TestContractMarkAttendeePrinted_ForeignTenant404s(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("IncrementAttendeePrintedCount should not be called when ownership fails")
			return 0, nil
		},
	})

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/printed"

	// Foreign tenant: attendee belongs to a different tenant than the caller.
	c, rec := newAuthedContext(e, http.MethodPost, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/printed")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// Missing: GetAttendeeByID returns nil, nil.
	hMissing := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("IncrementAttendeePrintedCount should not be called when the attendee is missing")
			return 0, nil
		},
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/printed")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendee.ID.String())
	if err := hMissing.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted (missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractMarkAttendeePrinted_InvalidUUID400s covers a malformed
// attendee_id path param — must 400 before ever touching the store.
func TestContractMarkAttendeePrinted_InvalidUUID400s(t *testing.T) {
	tenantID := uuid.New()
	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) {
			t.Fatal("store should not be reached for a malformed attendee_id")
			return nil, nil
		},
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("store should not be reached for a malformed attendee_id")
			return 0, nil
		},
	})

	e := echo.New()
	badPath := "/api/attendees/not-a-uuid/printed"
	c, rec := newAuthedContext(e, http.MethodPost, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:attendee_id/printed")
	c.SetParamNames("attendee_id")
	c.SetParamValues("not-a-uuid")
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted (invalid uuid): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, badPath, rec)
}
