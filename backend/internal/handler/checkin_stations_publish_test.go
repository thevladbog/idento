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

// --- PR #81 round-4 convergence, Finding 3: RegisterCheckinStation broker
// publish site --------------------------------------------------------------
//
// RegisterCheckinStation is an upsert: a fresh name creates a new station, a
// repeat name re-registers it (e.g. changing its zone binding). Either way
// it changes the monitor's stations[] list — a station showing up for the
// first time, or an existing station's zone binding (and therefore its
// future check-ins' attribution) changing. Unlike HeartbeatCheckinStation's
// periodic, throttled publish (Finding B5), registration is a discrete
// user-initiated action — same class as check-in/undo/reprint — so this
// site is UNthrottled: every successful registration publishes.

// TestRegisterCheckinStation_PublishesOnSuccess proves a successful
// registration (200) signals the monitor.
func TestRegisterCheckinStation_PublishesOnSuccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()
	now := time.Now()

	h := newCheckinStationHandler(event, nil,
		func(eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error) {
			return &models.CheckinStation{ID: stationID, EventID: eventID, Name: name, LastSeenAt: now, CreatedAt: now}, nil
		},
		nil, nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Entrance"}`, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful registration")
	}
}

// TestRegisterCheckinStation_FailedUpsertDoesNotPublish proves a store
// failure (500) never signals the monitor.
func TestRegisterCheckinStation_FailedUpsertDoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	h := newCheckinStationHandler(event, nil,
		func(uuid.UUID, string, *uuid.UUID) (*models.CheckinStation, error) {
			return nil, errors.New("insert failed")
		},
		nil, nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Entrance"}`, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a failed registration")
	}
}

// TestRegisterCheckinStation_ReregisterPublishesAgain proves re-registering
// the SAME station name (e.g. rebinding its zone) publishes again — unlike
// heartbeat, registration is never throttled.
func TestRegisterCheckinStation_ReregisterPublishesAgain(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()
	now := time.Now()

	h := newCheckinStationHandler(event, nil,
		func(eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error) {
			return &models.CheckinStation{ID: stationID, EventID: eventID, Name: name, LastSeenAt: now, CreatedAt: now}, nil
		},
		nil, nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationsPath(event.ID)

	c1, rec1 := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Entrance"}`, tenantID.String(), "admin")
	setCheckinStationsPathParams(c1, event.ID)
	if err := h.RegisterCheckinStation(c1); err != nil {
		t.Fatalf("RegisterCheckinStation (1st): %v", err)
	}
	if rec1.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec1.Code, rec1.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on the first registration")
	}

	c2, rec2 := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Entrance"}`, tenantID.String(), "admin")
	setCheckinStationsPathParams(c2, event.ID)
	if err := h.RegisterCheckinStation(c2); err != nil {
		t.Fatalf("RegisterCheckinStation (2nd, re-register): %v", err)
	}
	if rec2.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec2.Code, rec2.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on re-registration — unlike heartbeat, registration is never throttled")
	}
}

// TestRegisterCheckinStation_NilBrokerDoesNotPanic proves the nil-safe
// guard for the registration publish site.
func TestRegisterCheckinStation_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()
	now := time.Now()

	h := newCheckinStationHandler(event, nil,
		func(eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error) {
			return &models.CheckinStation{ID: stationID, EventID: eventID, Name: name, LastSeenAt: now, CreatedAt: now}, nil
		},
		nil, nil,
	)
	// h.Broker intentionally left nil.

	e := echo.New()
	path := checkinStationsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Entrance"}`, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// --- P4.2 Task 4: HeartbeatCheckinStation broker publish site ---

// TestHeartbeatCheckinStation_PublishesOn204 proves a successful heartbeat
// (204) signals the monitor — unlike the other three publish sites,
// heartbeat's only effect is last_seen_at, but the monitor's stations card
// renders exactly that field (P4.2 Task 4, self-review notes).
func TestHeartbeatCheckinStation_PublishesOn204(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()

	h := newCheckinStationHandler(event, nil, nil,
		func(uuid.UUID, uuid.UUID) error { return nil },
		nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c, event.ID, stationID)

	if err := h.HeartbeatCheckinStation(c); err != nil {
		t.Fatalf("HeartbeatCheckinStation: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful heartbeat")
	}
}

// TestHeartbeatCheckinStation_Unknown404DoesNotPublish proves an unknown
// station id (404) never signals the monitor.
func TestHeartbeatCheckinStation_Unknown404DoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()

	h := newCheckinStationHandler(event, nil, nil,
		func(uuid.UUID, uuid.UUID) error { return store.ErrCheckinStationNotFound },
		nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c, event.ID, stationID)

	if err := h.HeartbeatCheckinStation(c); err != nil {
		t.Fatalf("HeartbeatCheckinStation: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a 404")
	}
}

// --- Finding B5 (CodeRabbit, PR #81 bot-review round): heartbeat publish
// throttling ---------------------------------------------------------------
//
// Every station heartbeat lands here (20s cadence, checkin_stations.go
// doc); N stations on a larger event would otherwise fire a near-continuous
// stream of publishes, each one costing every attached monitor a full
// snapshot re-fetch. shouldPublishHeartbeat (checkin_stations.go) throttles
// heartbeat-SOURCED publishes to at most one per heartbeatPublishThrottle
// window, per event — independent of any other event's own window.
// Check-in/undo/reprint publishes (checkin_publish_test.go,
// attendee_printed_publish_test.go) are never throttled; this is the ONLY
// site that is.

// TestHeartbeatCheckinStation_ThrottlesRepeatedPublishesWithinWindow proves
// two heartbeats for the SAME event within the throttle window produce
// exactly one publish, not two.
func TestHeartbeatCheckinStation_ThrottlesRepeatedPublishesWithinWindow(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()

	h := newCheckinStationHandler(event, nil, nil,
		func(uuid.UUID, uuid.UUID) error { return nil },
		nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)

	c1, rec1 := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c1, event.ID, stationID)
	if err := h.HeartbeatCheckinStation(c1); err != nil {
		t.Fatalf("HeartbeatCheckinStation (1st): %v", err)
	}
	if rec1.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec1.Code, rec1.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on the first heartbeat")
	}

	c2, rec2 := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c2, event.ID, stationID)
	if err := h.HeartbeatCheckinStation(c2); err != nil {
		t.Fatalf("HeartbeatCheckinStation (2nd): %v", err)
	}
	if rec2.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec2.Code, rec2.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false — second heartbeat within the throttle window must not publish again")
	}
}

// TestHeartbeatCheckinStation_PublishesAgainAfterThrottleWindowElapses
// proves a heartbeat AFTER the window has elapsed publishes again. Uses the
// package var (shrunk here, restored via t.Cleanup) rather than a real
// 15-second wait — same idiom as monitor_stream.go's
// monitorStreamPingInterval and event_publish.go's publishCheckinTimeout.
func TestHeartbeatCheckinStation_PublishesAgainAfterThrottleWindowElapses(t *testing.T) {
	orig := heartbeatPublishThrottle
	heartbeatPublishThrottle = 20 * time.Millisecond
	t.Cleanup(func() { heartbeatPublishThrottle = orig })

	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()

	h := newCheckinStationHandler(event, nil, nil,
		func(uuid.UUID, uuid.UUID) error { return nil },
		nil,
	)
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)

	c1, _ := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c1, event.ID, stationID)
	if err := h.HeartbeatCheckinStation(c1); err != nil {
		t.Fatalf("HeartbeatCheckinStation (1st): %v", err)
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on the first heartbeat")
	}

	time.Sleep(heartbeatPublishThrottle * 3)

	c2, _ := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c2, event.ID, stationID)
	if err := h.HeartbeatCheckinStation(c2); err != nil {
		t.Fatalf("HeartbeatCheckinStation (2nd): %v", err)
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true — a heartbeat after the throttle window elapsed must publish again")
	}
}

// TestHeartbeatCheckinStation_ThrottlesIndependentlyPerEvent proves eventA's
// throttle window has no effect on eventB: a heartbeat for eventB
// immediately after one for eventA still publishes.
func TestHeartbeatCheckinStation_ThrottlesIndependentlyPerEvent(t *testing.T) {
	tenantID := uuid.New()
	eventA := contractEvent(tenantID, "Tech Summit A")
	eventB := contractEvent(tenantID, "Tech Summit B")
	stationA := uuid.New()
	stationB := uuid.New()

	events := map[uuid.UUID]*models.Event{eventA.ID: eventA, eventB.ID: eventB}
	h := New(&fakeStore{
		getEventByID:            func(id uuid.UUID) (*models.Event, error) { return events[id], nil },
		heartbeatCheckinStation: func(uuid.UUID, uuid.UUID) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	chA, unsubA := mem.Subscribe(eventA.ID)
	defer unsubA()
	chB, unsubB := mem.Subscribe(eventB.ID)
	defer unsubB()

	e := echo.New()

	pathA := checkinStationHeartbeatPath(eventA.ID, stationA)
	cA, _ := newAuthedContext(e, http.MethodPost, pathA, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(cA, eventA.ID, stationA)
	if err := h.HeartbeatCheckinStation(cA); err != nil {
		t.Fatalf("HeartbeatCheckinStation (eventA): %v", err)
	}
	if !pendingSignal(chA) {
		t.Fatal("eventA publish signal = false, want true on its first heartbeat")
	}

	pathB := checkinStationHeartbeatPath(eventB.ID, stationB)
	cB, _ := newAuthedContext(e, http.MethodPost, pathB, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(cB, eventB.ID, stationB)
	if err := h.HeartbeatCheckinStation(cB); err != nil {
		t.Fatalf("HeartbeatCheckinStation (eventB): %v", err)
	}
	if !pendingSignal(chB) {
		t.Fatal("eventB publish signal = false, want true — eventA's throttle window must not affect eventB")
	}
}

// TestHeartbeatCheckinStation_NilBrokerDoesNotPanic proves the nil-safe
// guard for the heartbeat publish site.
func TestHeartbeatCheckinStation_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()

	h := newCheckinStationHandler(event, nil, nil,
		func(uuid.UUID, uuid.UUID) error { return nil },
		nil,
	)
	// h.Broker intentionally left nil.

	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c, event.ID, stationID)

	if err := h.HeartbeatCheckinStation(c); err != nil {
		t.Fatalf("HeartbeatCheckinStation: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
