package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/broker"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

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
