package handler

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- P4.1 Task 4: reprint feed row on /printed ---
//
// These tests cover the OPTIONAL {event_id?, station_id?} body added to the
// pre-existing markAttendeePrinted endpoint (its unconditional-counter
// tests live in openapi_contract_attendee_printed_p3_test.go, untouched by
// this task). Judgment call (documented per the task brief): the body is
// parsed leniently — unknown fields and syntactically malformed JSON are
// both swallowed (the counter still increments, no body context is
// derived) — the ONLY 400 this body can trigger is a present event_id/
// station_id value that fails uuid.Parse.

// newMarkPrintedHandler wires a fakeStore for markAttendeePrinted +
// getCheckinActions sharing ONE in-memory `actions` slice — insertCheckinAction
// appends to it, getCheckinActions reads it back — so a test can prove a
// reprint row landed by calling GetCheckinActions on the SAME handler/store
// afterward (the brief's prescribed proof, reusing Task 3's feed list
// rather than inspecting fakeStore internals directly). getCheckinStationByID
// defaults to "any requested station_id belongs to this event" — fix round
// 1 added a resolveCheckinStation call gated on event_id/station_id both
// being present, so any test driving a station_id through this helper needs
// a station lookup wired up even if it isn't the thing under test.
func newMarkPrintedHandler(t *testing.T, event *models.Event, attendee *models.Attendee, incrementCount int) (*Handler, *[]store.CheckinActionRow) {
	t.Helper()
	actions := []store.CheckinActionRow{}
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getCheckinStationByID: func(id uuid.UUID) (*models.CheckinStation, error) {
			if event == nil {
				return nil, nil
			}
			return &models.CheckinStation{ID: id, EventID: event.ID, Name: "Main Entrance"}, nil
		},
		incrementAttendeePrintedCount: func(attendeeID uuid.UUID) (int, error) {
			if attendee != nil && attendeeID != attendee.ID {
				t.Fatalf("IncrementAttendeePrintedCount called with %s, want %s", attendeeID, attendee.ID)
			}
			return incrementCount, nil
		},
		insertCheckinAction: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID uuid.UUID) error {
			actions = append(actions, store.CheckinActionRow{
				ID:        uuid.New(),
				Action:    action,
				StationID: stationID,
				CreatedAt: time.Now(),
				Attendee:  store.CheckinActionAttendee{ID: attendeeID},
			})
			return nil
		},
		getCheckinActions: func(uuid.UUID, int) ([]store.CheckinActionRow, error) {
			return actions, nil
		},
	})
	return h, &actions
}

func markPrintedPath(attendeeID uuid.UUID) string {
	return "/api/attendees/" + attendeeID.String() + "/printed"
}

func setMarkPrintedPathParams(c echo.Context, attendeeID uuid.UUID) {
	c.SetPath("/api/attendees/:attendee_id/printed")
	c.SetParamNames("attendee_id")
	c.SetParamValues(attendeeID.String())
}

// TestOpenAPIContract_MarkAttendeePrinted_ReprintBodyLogsFeedRow proves the
// core P4.1 Task 4 behavior end-to-end: a body carrying {event_id,
// station_id} bumps the counter AND logs a 'reprint' checkin_actions row —
// verified by calling GetCheckinActions on the SAME fakeStore afterward
// (the actions list, not a fakeStore-internal spy).
func TestOpenAPIContract_MarkAttendeePrinted_ReprintBodyLogsFeedRow(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	stationID := uuid.New()

	h, _ := newMarkPrintedHandler(t, event, attendee, 3)
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + event.ID.String() + `","station_id":"` + stationID.String() + `"}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got MarkAttendeePrintedResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.PrintedCount != 3 {
		t.Fatalf("printed_count = %d, want 3", got.PrintedCount)
	}
	validateResponse(t, http.MethodPost, path, rec)

	// Prove the feed row via GetCheckinActions on the same handler/store.
	actionsPath := checkinActionsPath(event.ID)
	c2, rec2 := newAuthedContext(e, http.MethodGet, actionsPath, "", tenantID.String(), "admin")
	setCheckinActionsPathParams(c2, event.ID)
	if err := h.GetCheckinActions(c2); err != nil {
		t.Fatalf("GetCheckinActions: %v", err)
	}
	var actionsResp CheckinActionsResponse
	if err := jsonUnmarshalBody(rec2, &actionsResp); err != nil {
		t.Fatalf("unmarshal actions: %v", err)
	}
	if len(actionsResp.Actions) != 1 {
		t.Fatalf("len(actions) = %d, want 1", len(actionsResp.Actions))
	}
	row := actionsResp.Actions[0]
	if row.Action != "reprint" {
		t.Errorf("action = %q, want reprint", row.Action)
	}
	if row.StationID == nil || *row.StationID != stationID {
		t.Errorf("station_id = %v, want %s", row.StationID, stationID)
	}
	if row.Attendee.ID != attendee.ID {
		t.Errorf("attendee.id = %s, want %s", row.Attendee.ID, attendee.ID)
	}
}

// TestOpenAPIContract_MarkAttendeePrinted_NoBodyCounterOnlyNoFeedRow proves
// back-compat: the pre-existing badge-editor bulk print caller sends no
// body at all — the counter still bumps, but insertCheckinAction is never
// called (a call would fail the test via t.Fatal in the fake).
func TestOpenAPIContract_MarkAttendeePrinted_NoBodyCounterOnlyNoFeedRow(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			return 1, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			t.Fatal("InsertCheckinAction should not be called when no event_id was supplied")
			return nil
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)

	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got MarkAttendeePrintedResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.PrintedCount != 1 {
		t.Fatalf("printed_count = %d, want 1", got.PrintedCount)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_MarkAttendeePrinted_MalformedBodyStillCounts covers
// the implementer's chosen leniency: syntactically broken JSON is
// swallowed (not 400) and the counter still increments, exactly like no
// body at all — the print flow must never be blocked by a bad print-context
// body.
func TestOpenAPIContract_MarkAttendeePrinted_MalformedBodyStillCounts(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			return 7, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			t.Fatal("InsertCheckinAction should not be called for a malformed body (no event_id could be parsed)")
			return nil
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)

	c, rec := newAuthedContext(e, http.MethodPost, path, `{"event_id": not-json-at-all`, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (malformed body is lenient, not 400), got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got MarkAttendeePrintedResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.PrintedCount != 7 {
		t.Fatalf("printed_count = %d, want 7", got.PrintedCount)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_MarkAttendeePrinted_UnknownFieldsIgnored proves the
// other half of the leniency choice: EXTRA/unknown fields in an otherwise
// valid body don't 400 — they're ignored, and a valid event_id alongside
// them still logs the reprint row.
func TestOpenAPIContract_MarkAttendeePrinted_UnknownFieldsIgnored(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h, actions := newMarkPrintedHandler(t, event, attendee, 2)
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + event.ID.String() + `","printer_name":"Zebra ZD420","unexpected":42}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
	if len(*actions) != 1 {
		t.Fatalf("len(actions) = %d, want 1 (unknown fields must not block valid event_id from logging)", len(*actions))
	}
}

// TestOpenAPIContract_MarkAttendeePrinted_PresentButInvalidEventID400s
// covers the ONE case the implementer's leniency choice still rejects: a
// present event_id key whose value fails uuid.Parse. This must 400 BEFORE
// the counter increments (never called), matching the brief's preferred
// "lenient-ignore of unknown, 400 only on a present-but-bad uuid".
func TestOpenAPIContract_MarkAttendeePrinted_PresentButInvalidEventID400s(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("IncrementAttendeePrintedCount should not be called when the body 400s")
			return 0, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			t.Fatal("InsertCheckinAction should not be called when the body 400s")
			return nil
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)

	c, rec := newAuthedContext(e, http.MethodPost, path, `{"event_id":"not-a-uuid"}`, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_MarkAttendeePrinted_PresentButInvalidStationID400s
// mirrors the event_id case for station_id — a valid event_id alongside an
// invalid station_id must still 400 before incrementing.
func TestOpenAPIContract_MarkAttendeePrinted_PresentButInvalidStationID400s(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("IncrementAttendeePrintedCount should not be called when the body 400s")
			return 0, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			t.Fatal("InsertCheckinAction should not be called when the body 400s")
			return nil
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + event.ID.String() + `","station_id":"not-a-uuid"}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_MarkAttendeePrinted_ForeignEventIDRejected is the fix
// round 1 regression test: the body's event_id is parseable but does NOT
// match the attendee's own event (fetched via requireAttendeeOwnership, the
// only trustworthy event context). Before the fix, this event_id was passed
// straight to InsertCheckinAction — an authenticated caller who legitimately
// owns the ATTENDEE could get a 'reprint' row logged into an arbitrary
// OTHER event's/tenant's checkin_actions feed, since GetCheckinActions has
// no tenant scoping. This must 400 BEFORE the counter increments (mirrors
// StationCheckin/UndoCheckin/BadgeZPL's "Attendee does not belong to this
// event" treatment of the same mismatch), and neither the counter nor the
// feed insert may be reached.
func TestOpenAPIContract_MarkAttendeePrinted_ForeignEventIDRejected(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	foreignEvent := contractEvent(uuid.New(), "Other Tenant's Conference")

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("IncrementAttendeePrintedCount should not be called when event_id doesn't match the attendee's own event")
			return 0, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			t.Fatal("InsertCheckinAction should not be called when event_id doesn't match the attendee's own event")
			return nil
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + foreignEvent.ID.String() + `"}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_MarkAttendeePrinted_ForeignStationIDRejected covers
// fix round 1's second half: event_id matches the attendee's own event, but
// station_id belongs to a DIFFERENT event. resolveCheckinStation (shared
// with StationCheckin/UndoCheckin, checkin.go:76-88) must reject this the
// same way it already rejects a foreign station_id there — 400 before the
// counter increments, no feed row attempted.
func TestOpenAPIContract_MarkAttendeePrinted_ForeignStationIDRejected(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	foreignStationID := uuid.New()

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getCheckinStationByID: func(id uuid.UUID) (*models.CheckinStation, error) {
			// The station exists, but is registered to a DIFFERENT event
			// than the one in the (matching) request body.
			return &models.CheckinStation{ID: id, EventID: uuid.New(), Name: "Foreign Station"}, nil
		},
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			t.Fatal("IncrementAttendeePrintedCount should not be called when station_id doesn't belong to the event")
			return 0, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			t.Fatal("InsertCheckinAction should not be called when station_id doesn't belong to the event")
			return nil
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + event.ID.String() + `","station_id":"` + foreignStationID.String() + `"}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_MarkAttendeePrinted_EventIDNoStationLogsNilStation
// proves a station-less reprint (event_id present, station_id absent) logs
// the feed row with a nil station_id rather than defaulting it to
// something fabricated.
func TestOpenAPIContract_MarkAttendeePrinted_EventIDNoStationLogsNilStation(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h, actions := newMarkPrintedHandler(t, event, attendee, 5)
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + event.ID.String() + `"}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
	if len(*actions) != 1 {
		t.Fatalf("len(actions) = %d, want 1", len(*actions))
	}
	if (*actions)[0].StationID != nil {
		t.Errorf("StationID = %v, want nil", (*actions)[0].StationID)
	}
}

// TestOpenAPIContract_MarkAttendeePrinted_ReprintLogFailureStillReturns200
// proves reprint-logging is best-effort: InsertCheckinAction failing must
// NOT change the response — the counter increment already committed by the
// time logging is attempted.
func TestOpenAPIContract_MarkAttendeePrinted_ReprintLogFailureStillReturns200(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) {
			return 4, nil
		},
		insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
			return errors.New("boom")
		},
	})
	e := echo.New()
	path := markPrintedPath(attendee.ID)
	body := `{"event_id":"` + event.ID.String() + `"}`

	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)
	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (reprint-logging failure must not fail the request), got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got MarkAttendeePrintedResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.PrintedCount != 4 {
		t.Fatalf("printed_count = %d, want 4", got.PrintedCount)
	}
	validateResponse(t, http.MethodPost, path, rec)
}
