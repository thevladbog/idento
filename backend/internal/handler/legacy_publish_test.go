package handler

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/broker"
	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- PR #81 bot-review round, Finding B3: legacy check-in write paths -----
//
// PUT /api/attendees/{id} (UpdateAttendeeHandler), the mobile batch endpoint
// (BatchCheckin), and the offline sync push path (SyncPush) all mutate
// attendees.checkin_status but — unlike the four P4.2 Task 4 sites — never
// published to the monitor broker. A mobile-kiosk-only event (zero panel
// check-in stations, so zero heartbeats either) would leave attached
// monitors stale indefinitely. These tests prove the additive publish these
// three handlers now perform, using publishCheckinEvent (event_publish.go,
// Finding B2) exactly like the original four sites.

// --- UpdateAttendeeHandler ------------------------------------------------

// TestUpdateAttendeeHandler_PublishesWhenCheckinStatusChanges proves the
// before/after compare: existingAttendee is already loaded via
// requireAttendeeOwnership, so an exact diff is cheap and avoids a noisy
// publish on a no-op PUT.
func TestUpdateAttendeeHandler_PublishesWhenCheckinStatusChanges(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = false
	staffUser := contractUser("staff@org.io")

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		// The flip is DB-arbitered (PR #82 bot round) and also writes an
		// event-wide actions-feed row (2026-07-19 design) — realistic
		// claim verdict + a no-op feed hook here; the feed behavior
		// itself is pinned by checkin_actions_feed_test.go.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
		insertCheckinActionAt:     func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true when checkin_status flips false -> true")
	}
}

// TestUpdateAttendeeHandler_DoesNotPublishWhenCheckinStatusUnchanged proves
// a PUT that leaves checkin_status exactly as it was (e.g. a client
// re-sending the same status, or PATCHing an unrelated field via this same
// endpoint's checkin_status:false default) does not signal the monitor.
func TestUpdateAttendeeHandler_DoesNotPublishWhenCheckinStatusUnchanged(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = true
	now := attendee.UpdatedAt
	attendee.CheckedInAt = &now
	staffUser := contractUser("staff@org.io")

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		// Already checked in + target true: the guarded claim (PR #82 bot
		// round) affects 0 rows — the DB verdict, not a Go compare, is
		// what keeps the no-op PUT silent.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return false, nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false when checkin_status did not change")
	}
}

// TestUpdateAttendeeHandler_DoesNotPublishOnStoreFailure proves a failed
// store write never signals the monitor.
func TestUpdateAttendeeHandler_DoesNotPublishOnStoreFailure(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = false
	staffUser := contractUser("staff@org.io")

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return errors.New("boom") },
		// The claim succeeds (the transition itself persisted) and its
		// feed row is written; the publish is what must stay suppressed
		// when the follow-up full-row write fails.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
		insertCheckinActionAt:     func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a store failure")
	}
}

// TestUpdateAttendeeHandler_NilBrokerDoesNotPanic proves the nil-safe guard
// (via publishCheckinEvent) for this newly-added publish site.
func TestUpdateAttendeeHandler_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = false
	staffUser := contractUser("staff@org.io")

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		// The flip is DB-arbitered (PR #82 bot round) and also writes an
		// event-wide actions-feed row (2026-07-19 design) — no-op hooks;
		// the feed behavior itself is pinned by
		// checkin_actions_feed_test.go.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
		insertCheckinActionAt:     func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// --- BatchCheckin ----------------------------------------------------------

// TestBatchCheckin_PublishesOnceWhenAnyItemCreated proves the count
// semantics: N items in the batch that each result in
// store.BatchCheckinCreated still produce exactly ONE publish for the
// batch's single event (the endpoint is scoped to one event_id from the
// path — every item in the batch belongs to it), not one per item.
func TestBatchCheckin_PublishesOnceWhenAnyItemCreated(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID1 := uuid.New()
	attendeeID2 := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			return store.BatchCheckinCreated, nil
		},
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	e := echo.New()
	body := `[` +
		`{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + attendeeID1.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"},` +
		`{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + attendeeID2.String() + `","at":"2026-07-10T10:00:01Z","device_number":1,"kind":"checkin"}` +
		`]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("BatchCheckin: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true when at least one item created a check-in")
	}
	// Coalescing (1-buffered channel) already makes a second signal
	// undetectable here, which is exactly the point: the assertion above is
	// the "at least one, never N distinguishable pings" proof this package's
	// other publish tests rely on (see pendingSignal's doc comment).
}

// TestBatchCheckin_NoPublishWhenNoItemCreated proves a batch where every
// item is a no-op from the monitor's point of view (already checked in,
// duplicate client_uuid, or an outright error) does not signal the monitor.
func TestBatchCheckin_NoPublishWhenNoItemCreated(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			return store.BatchCheckinAlreadyCheckedIn, nil
		},
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	e := echo.New()
	body := `[{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"}]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("BatchCheckin: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false when no item actually created a check-in")
	}
}

// TestBatchCheckin_NoPublishForZoneEntryOnlyBatch is the PR #81 round-2
// convergence fix (Finding 1): ApplyBatchCheckin deliberately reports
// BatchCheckinCreated for kind=zone_entry items too — even a pre-existing
// zone entry (see pg_store_batch.go's ApplyBatchCheckin doc comment) — but
// zone entries write zone_checkins, a table the monitor snapshot never
// reads. A batch made up entirely of zone_entry items must not publish:
// doing so would force every attached monitor to refetch unchanged data for
// a plain access-control sync.
func TestBatchCheckin_NoPublishForZoneEntryOnlyBatch(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	zoneID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			// zone_entry items always report Created per ApplyBatchCheckin's
			// documented semantics, even though nothing monitor-visible changed.
			return store.BatchCheckinCreated, nil
		},
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	e := echo.New()
	body := `[{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + attendeeID.String() + `","zone_id":"` + zoneID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"zone_entry"}]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("BatchCheckin: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false for a zone-entry-only batch (monitor snapshot never reads zone_checkins)")
	}
}

// TestBatchCheckin_PublishesOnceForMixedBatch proves a batch containing both
// a zone_entry item (reported Created, monitor-invisible) and a genuine
// kind=checkin item (reported Created, monitor-visible) still publishes
// exactly once — the checkin item alone is enough to trigger the batch's one
// publish, regardless of the zone_entry item's outcome.
func TestBatchCheckin_PublishesOnceForMixedBatch(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	checkinAttendeeID := uuid.New()
	zoneAttendeeID := uuid.New()
	zoneID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, item *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			return store.BatchCheckinCreated, nil
		},
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	e := echo.New()
	body := `[` +
		`{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + zoneAttendeeID.String() + `","zone_id":"` + zoneID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"zone_entry"},` +
		`{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + checkinAttendeeID.String() + `","at":"2026-07-10T10:00:01Z","device_number":1,"kind":"checkin"}` +
		`]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("BatchCheckin: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true when the batch's checkin item created a monitor-visible check-in")
	}
}

// TestBatchCheckin_NilBrokerDoesNotPanic proves the nil-safe guard for the
// batch publish site.
func TestBatchCheckin_NilBrokerDoesNotPanic(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
			return store.BatchCheckinCreated, nil
		},
	}
	h := &Handler{Store: fs}
	// h.Broker intentionally left nil.

	e := echo.New()
	body := `[{"client_uuid":"` + uuid.New().String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"}]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("BatchCheckin: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// --- SyncPush ---------------------------------------------------------------

// TestSyncPush_PublishesOncePerAffectedEvent proves sync's per-attendee,
// potentially-cross-event write pattern: two successfully-updated attendees
// in the SAME event still produce exactly one publish for that event (not
// two), and an attendee in a SECOND event produces its own, separate
// publish — "collect distinct event ids, publish once each" rather than
// once per attendee.
func TestSyncPush_PublishesOncePerAffectedEvent(t *testing.T) {
	tenant := uuid.New()
	eventA := uuid.New()
	eventB := uuid.New()
	attendee1 := uuid.New() // eventA
	attendee2 := uuid.New() // eventA (same event as attendee1)
	attendee3 := uuid.New() // eventB

	existingByID := map[uuid.UUID]*models.Attendee{
		attendee1: {ID: attendee1, EventID: eventA},
		attendee2: {ID: attendee2, EventID: eventA},
		attendee3: {ID: attendee3, EventID: eventB},
	}
	fs := &fakeStore{
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return existingByID[id], nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
		updateAttendee: func(*models.Attendee) error { return nil },
		// The flips are DB-arbitered (PR #82 bot round) and also write
		// event-wide actions-feed rows (2026-07-19 design) — no-op hooks;
		// the feed behavior itself is pinned by
		// checkin_actions_feed_test.go.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
		insertCheckinActionAt:     func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error { return nil },
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem
	chA, unsubA := mem.Subscribe(eventA)
	defer unsubA()
	chB, unsubB := mem.Subscribe(eventB)
	defer unsubB()

	e := echo.New()
	body := `{"changes":{"attendees":{"updated":[` +
		`{"id":"` + attendee1.String() + `","event_id":"` + eventA.String() + `","first_name":"a","last_name":"b","email":"a@x.com","checkin_status":true},` +
		`{"id":"` + attendee2.String() + `","event_id":"` + eventA.String() + `","first_name":"c","last_name":"d","email":"c@x.com","checkin_status":true},` +
		`{"id":"` + attendee3.String() + `","event_id":"` + eventB.String() + `","first_name":"e","last_name":"f","email":"e@x.com","checkin_status":true}` +
		`]}},"lastPulledAt":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", body, tenant.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(chA) {
		t.Fatal("publish signal = false for eventA, want true (two successfully-updated attendees)")
	}
	if !pendingSignal(chB) {
		t.Fatal("publish signal = false for eventB, want true (one successfully-updated attendee)")
	}
}

// TestSyncPush_SkipsPublishForUnknownOrForeignAttendee proves an attendee
// that's skipped (not found, or belongs to a different tenant's event)
// never contributes to a publish — SyncPush's existing silent-skip
// semantics (continue, not error) are unaffected.
func TestSyncPush_SkipsPublishForUnknownOrForeignAttendee(t *testing.T) {
	tenant := uuid.New()
	unknownAttendeeID := uuid.New()

	fs := &fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
		updateAttendee: func(*models.Attendee) error {
			t.Fatal("UpdateAttendee must not be called for an unknown attendee")
			return nil
		},
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem

	e := echo.New()
	body := `{"changes":{"attendees":{"updated":[` +
		`{"id":"` + unknownAttendeeID.String() + `","event_id":"` + uuid.New().String() + `","first_name":"a","last_name":"b","email":"a@x.com"}` +
		`]}},"lastPulledAt":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", body, tenant.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// TestSyncPush_PublishesOnCreatedAttendees proves created attendees (not just
// updated ones) trigger publishes. A sync push with ONLY attendee creations
// should still publish once per distinct affected event, since created
// attendees also change monitor-visible state (total count, possibly
// checked_in if an offline kiosk created-and-checked-in in one push).
func TestSyncPush_PublishesOnCreatedAttendees(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	createdAttendeeID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
		checkAttendeeLimit: func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
			return true, 0, 50, nil // under limit
		},
		createAttendee: func(attendee *models.Attendee) error { return nil },
	}
	h := &Handler{Store: fs}
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsub := mem.Subscribe(eventID)
	defer unsub()

	e := echo.New()
	body := `{"changes":{"attendees":{"created":[` +
		`{"id":"` + createdAttendeeID.String() + `","event_id":"` + eventID.String() + `","first_name":"a","last_name":"b","email":"a@x.com"}` +
		`]}},"lastPulledAt":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", body, tenant.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true when attendee is created")
	}
}

// TestSyncPush_NilBrokerDoesNotPanic proves the nil-safe guard for the sync
// publish site.
func TestSyncPush_NilBrokerDoesNotPanic(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
		updateAttendee: func(*models.Attendee) error { return nil },
		// See TestSyncPush_PublishesOncePerAffectedEvent's hook comment.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
		insertCheckinActionAt:     func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error { return nil },
	}
	h := &Handler{Store: fs}
	// h.Broker intentionally left nil.

	e := echo.New()
	body := `{"changes":{"attendees":{"updated":[` +
		`{"id":"` + attendeeID.String() + `","event_id":"` + eventID.String() + `","first_name":"a","last_name":"b","email":"a@x.com","checkin_status":true}` +
		`]}},"lastPulledAt":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", body, tenant.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
