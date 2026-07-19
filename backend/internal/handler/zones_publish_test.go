package handler

import (
	"errors"
	"net/http"
	"testing"

	"idento/backend/internal/broker"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- PR #81 round-4 convergence, Finding 4: zone CRUD broker publish sites -
//
// CreateEventZone/UpdateEventZone/DeleteEventZone all change the monitor's
// zone list (Totals/Zones card), and DeleteEventZone specifically moves
// every station bound to the deleted zone's currently-checked-in attendees
// to "unattributed" (checkin_stations.zone_id is ON DELETE SET NULL — see
// migration 000019) — a monitor-visible state change with no OTHER publish
// site to cover it. Same class as check-in/undo/reprint/registration: a
// discrete user-initiated action, so all three sites here are UNthrottled.

// TestCreateEventZone_PublishesOnSuccess proves a successful zone creation
// (201) signals the monitor.
func TestCreateEventZone_PublishesOnSuccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		createEventZone: func(*models.EventZone) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/zones"
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall","zone_type":"general"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful zone creation")
	}
}

// TestCreateEventZone_FailedCreateDoesNotPublish proves a store failure
// (500) never signals the monitor.
func TestCreateEventZone_FailedCreateDoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		createEventZone: func(*models.EventZone) error { return errors.New("insert failed") },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/zones"
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a failed zone creation")
	}
}

// TestCreateEventZone_NilBrokerDoesNotPanic proves the nil-safe guard for
// the create-zone publish site.
func TestCreateEventZone_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		createEventZone: func(*models.EventZone) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/zones"
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// TestUpdateEventZone_PublishesOnSuccess proves a successful zone update
// (200) signals the monitor, keyed off the ZONE's event_id (the request
// body/path only carry the zone id, never event_id).
func TestUpdateEventZone_PublishesOnSuccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		updateEventZone:  func(*models.EventZone) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"name":"Main Hall 2"}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())

	if err := h.UpdateEventZone(c); err != nil {
		t.Fatalf("UpdateEventZone: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful zone update")
	}
}

// TestUpdateEventZone_FailedUpdateDoesNotPublish proves a store failure
// (500) never signals the monitor.
func TestUpdateEventZone_FailedUpdateDoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		updateEventZone:  func(*models.EventZone) error { return errors.New("update failed") },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"name":"Main Hall 2"}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())

	if err := h.UpdateEventZone(c); err != nil {
		t.Fatalf("UpdateEventZone: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a failed zone update")
	}
}

// TestUpdateEventZone_NilBrokerDoesNotPanic proves the nil-safe guard for
// the update-zone publish site.
func TestUpdateEventZone_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		updateEventZone:  func(*models.EventZone) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"name":"Main Hall 2"}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())

	if err := h.UpdateEventZone(c); err != nil {
		t.Fatalf("UpdateEventZone: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// TestDeleteEventZone_PublishesOnSuccess proves a successful zone deletion
// (200) signals the monitor — deletion moves every station bound to this
// zone's currently-checked-in attendees to unattributed (ON DELETE SET
// NULL), which the monitor must reflect.
func TestDeleteEventZone_PublishesOnSuccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		deleteEventZone:  func(uuid.UUID) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())

	if err := h.DeleteEventZone(c); err != nil {
		t.Fatalf("DeleteEventZone: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful zone deletion")
	}
}

// TestDeleteEventZone_FailedDeleteDoesNotPublish proves a store failure
// (500) never signals the monitor.
func TestDeleteEventZone_FailedDeleteDoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		deleteEventZone:  func(uuid.UUID) error { return errors.New("delete failed") },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())

	if err := h.DeleteEventZone(c); err != nil {
		t.Fatalf("DeleteEventZone: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a failed zone deletion")
	}
}

// TestDeleteEventZone_NilBrokerDoesNotPanic proves the nil-safe guard for
// the delete-zone publish site.
func TestDeleteEventZone_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		deleteEventZone:  func(uuid.UUID) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())

	if err := h.DeleteEventZone(c); err != nil {
		t.Fatalf("DeleteEventZone: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
