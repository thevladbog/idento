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

// --- PR #81 round-3 convergence, Backend Finding 3: attendee CRUD never
// publishes; totals go stale ------------------------------------------------
//
// CreateAttendee, DeleteAttendee, and BulkCreateAttendees all change the
// monitor snapshot's `total` (DeleteAttendee can also change `checked_in`,
// for an attendee who was currently checked in) without ever publishing to
// the monitor broker — UpdateAttendee already publishes (round-1 fix,
// legacy_publish_test.go), but a running event with no station heartbeat
// would otherwise leave every attached monitor stale indefinitely after a
// plain add/delete. These tests prove the additive publish these three
// handlers now perform, using publishCheckinEvent (event_publish.go) exactly
// like every other publish site in this package.

// --- CreateAttendee ---------------------------------------------------------

func TestCreateAttendee_PublishesOnSuccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	h := New(&fakeStore{
		getEventByID:   func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAttendee: func(*models.Attendee) error { return nil },
		logUsage:       func(*models.UsageLog) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees"
	c, rec := newAuthedContext(e, http.MethodPost, path,
		`{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.CreateAttendee(c); err != nil {
		t.Fatalf("CreateAttendee: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful create (monitor `total` changed)")
	}
}

func TestCreateAttendee_DoesNotPublishOnStoreFailure(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	h := New(&fakeStore{
		getEventByID:   func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAttendee: func(*models.Attendee) error { return errors.New("boom") },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees"
	c, rec := newAuthedContext(e, http.MethodPost, path,
		`{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.CreateAttendee(c); err != nil {
		t.Fatalf("CreateAttendee: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a store failure")
	}
}

func TestCreateAttendee_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	h := New(&fakeStore{
		getEventByID:   func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAttendee: func(*models.Attendee) error { return nil },
		logUsage:       func(*models.UsageLog) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees"
	c, rec := newAuthedContext(e, http.MethodPost, path,
		`{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.CreateAttendee(c); err != nil {
		t.Fatalf("CreateAttendee: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// --- DeleteAttendee ----------------------------------------------------------

func TestDeleteAttendee_PublishesOnSuccess(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.DeleteAttendee(c); err != nil {
		t.Fatalf("DeleteAttendee: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true on a successful delete (monitor `total`/`checked_in` changed)")
	}
}

func TestDeleteAttendee_DoesNotPublishOnStoreFailure(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return errors.New("boom") },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.DeleteAttendee(c); err != nil {
		t.Fatalf("DeleteAttendee: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a store failure")
	}
}

func TestDeleteAttendee_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.DeleteAttendee(c); err != nil {
		t.Fatalf("DeleteAttendee: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// --- BulkCreateAttendees -----------------------------------------------------

// TestBulkCreateAttendees_PublishesOnceWhenAtLeastOneCreated proves the
// count semantics: a batch of N rows that ALL create successfully still
// produces exactly ONE publish for the batch's single event_id (the endpoint
// is scoped to one event_id from the path), not one per row.
func TestBulkCreateAttendees_PublishesOnceWhenAtLeastOneCreated(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	body := `{"attendees":[` +
		`{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"},` +
		`{"first_name":"Grace","last_name":"Hopper","email":"grace@example.com"}` +
		`]}`

	h := New(&fakeStore{
		getEventByID:          func(uuid.UUID) (*models.Event, error) { return event, nil },
		checkAttendeeLimit:    func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return true, 0, 100, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) { return nil, nil },
		createAttendee:        func(*models.Attendee) error { return nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/bulk"
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("BulkCreateAttendees: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true when at least one row was created")
	}
	// Coalescing (1-buffered channel) already makes a second signal
	// undetectable here — same "at least one, never N distinguishable
	// pings" proof this package's other batch publish tests rely on (see
	// pendingSignal's doc comment / TestBatchCheckin_PublishesOnceWhenAnyItemCreated).
}

// TestBulkCreateAttendees_DoesNotPublishWhenAllDuplicates proves a batch
// where every row is skipped as a duplicate (createAttendee never called)
// does not signal the monitor — nothing monitor-visible changed.
func TestBulkCreateAttendees_DoesNotPublishWhenAllDuplicates(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	existing := contractAttendee(event.ID)
	existing.Email = "ada@example.com"
	body := `{"attendees":[{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}]}`

	h := New(&fakeStore{
		getEventByID:       func(uuid.UUID) (*models.Event, error) { return event, nil },
		checkAttendeeLimit: func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return true, 0, 100, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) {
			return []*models.Attendee{existing}, nil
		},
		createAttendee: func(*models.Attendee) error {
			t.Fatal("CreateAttendee must not be called for an all-duplicate batch")
			return nil
		},
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/bulk"
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("BulkCreateAttendees: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false when every row was skipped as a duplicate")
	}
}

// TestBulkCreateAttendees_DoesNotPublishOnLimitExceeded proves a
// request-level failure (the whole batch rejected before any row is
// touched) never signals the monitor.
func TestBulkCreateAttendees_DoesNotPublishOnLimitExceeded(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	body := `{"attendees":[{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}]}`

	h := New(&fakeStore{
		getEventByID:       func(uuid.UUID) (*models.Event, error) { return event, nil },
		checkAttendeeLimit: func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return false, 100, 100, nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/bulk"
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("BulkCreateAttendees: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false when the batch is rejected before any row is created")
	}
}

func TestBulkCreateAttendees_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	body := `{"attendees":[{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}]}`

	h := New(&fakeStore{
		getEventByID:          func(uuid.UUID) (*models.Event, error) { return event, nil },
		checkAttendeeLimit:    func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return true, 0, 100, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) { return nil, nil },
		createAttendee:        func(*models.Attendee) error { return nil },
	})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/bulk"
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("BulkCreateAttendees: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
