package handler

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/middleware"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func contractAttendee(eventID uuid.UUID) *models.Attendee {
	now := time.Now()
	return &models.Attendee{
		ID:        uuid.New(),
		EventID:   eventID,
		FirstName: "Ada",
		LastName:  "Lovelace",
		Email:     "ada@example.com",
		Code:      "ABC123",
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func TestContractGetAttendees(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendees := []*models.Attendee{contractAttendee(event.ID)}
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) {
			return attendees, nil
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: event exists but belongs to a different tenant (requireEventOwnership
	// masks "foreign" as "missing" — no existence oracle).
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractGetAttendeeDetail exercises the single-attendee fetch used by
// the panel's attendee drawer to support deep-linking (?attendee=<id> must
// render correctly on a fresh page load, not just after a client-side row
// click where the data might already be cached).
func TestContractGetAttendeeDetail(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.GetAttendeeDetail(c); err != nil {
		t.Fatalf("GetAttendeeDetail: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: attendee does not exist (GetAttendeeByID returns nil, nil).
	hMissing := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := hMissing.GetAttendeeDetail(c); err != nil {
		t.Fatalf("GetAttendeeDetail (missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: attendee exists but belongs to a different tenant (requireAttendeeOwnership
	// masks "foreign" as "missing" — no existence oracle).
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.GetAttendeeDetail(c); err != nil {
		t.Fatalf("GetAttendeeDetail (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 400: malformed id — never reaches the store.
	badPath := "/api/attendees/not-a-uuid"
	c, rec = newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetAttendeeDetail(c); err != nil {
		t.Fatalf("GetAttendeeDetail (malformed id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)
}

func TestContractCreateAttendee(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID:   func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAttendee: func(*models.Attendee) error { return nil },
		logUsage:       func(*models.UsageLog) error { return nil },
	})
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
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractCreateAttendeeLimitExceeded exercises middleware.CheckAttendeeLimits
// directly (it wraps CreateAttendee as route-level middleware — see handler.go's
// api.POST(".../attendees", h.CreateAttendee, middleware.CheckAttendeeLimits(h.Store)))
// covering both branches that differ from middleware.CheckLimits (which wraps
// CreateEvent/CreateUser): the 403 body shape happens to match LimitExceededError
// exactly (same fields, since adding is always 1 here — contrast
// BulkLimitExceededError, which adds a real "adding" field), but CheckAttendeeLimits
// ALSO has a genuine 500 branch that CheckLimits does not: a store failure checking
// the limit is surfaced honestly as an error instead of being folded into the same
// 403 as a real limit breach.
func TestContractCreateAttendeeLimitExceeded(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	path := "/api/events/" + eventID.String() + "/attendees"
	next := func(c echo.Context) error {
		t.Fatal("next handler should not be called once CheckAttendeeLimits rejects the request")
		return nil
	}
	e := echo.New()

	// 403: limit breached.
	fs := &fakeStore{
		checkAttendeeLimit: func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return false, 3, 3, nil },
	}
	mw := middleware.CheckAttendeeLimits(fs)
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"first_name":"Ada"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := mw(next)(c); err != nil {
		t.Fatalf("CheckAttendeeLimits: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: store failure checking the limit — CheckLimits has no equivalent branch.
	fs2 := &fakeStore{
		checkAttendeeLimit: func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) {
			return false, 0, 0, errors.New("db unavailable")
		},
	}
	mw2 := middleware.CheckAttendeeLimits(fs2)
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"first_name":"Ada"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := mw2(next)(c); err != nil {
		t.Fatalf("CheckAttendeeLimits (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractBulkCreateAttendees(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	body := `{"attendees":[{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}]}`
	h := New(&fakeStore{
		getEventByID:          func(uuid.UUID) (*models.Event, error) { return event, nil },
		checkAttendeeLimit:    func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return true, 0, 100, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) { return nil, nil },
		createAttendee:        func(*models.Attendee) error { return nil },
	})
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
	validateResponse(t, http.MethodPost, path, rec)

	// 403: the whole batch would exceed attendees_per_event. Checked in-handler
	// via Store.CheckAttendeeLimit(..., len(req.Attendees)) with c.JSON directly
	// (not echo.NewHTTPError), so this body carries a real "adding" field —
	// BulkLimitExceededError, not the reused LimitExceededError from the
	// single-create route.
	h2 := New(&fakeStore{
		getEventByID:       func(uuid.UUID) (*models.Event, error) { return event, nil },
		checkAttendeeLimit: func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) { return false, 100, 100, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h2.BulkCreateAttendees(c); err != nil {
		t.Fatalf("BulkCreateAttendees (limit exceeded): %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: no attendees provided — echo.NewHTTPError, so the handler returns an
	// error instead of writing to rec directly; render it like Echo would.
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"attendees":[]}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.BulkCreateAttendees(c); err != nil {
		e.HTTPErrorHandler(err, c)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractGenerateAttendeeCodes(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.Code = ""
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) {
			return []*models.Attendee{attendee}, nil
		},
		updateAttendee: func(*models.Attendee) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/generate-codes"
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/generate-codes")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GenerateAttendeeCodes(c); err != nil {
		t.Fatalf("GenerateAttendeeCodes: %v", err)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractExportAttendeesCSV(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) {
			return []*models.Attendee{attendee}, nil
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/export"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/export")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.ExportAttendeesCSV(c); err != nil {
		t.Fatalf("ExportAttendeesCSV: %v", err)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv" {
		t.Fatalf("want text/csv, got %s", ct)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractGetAttendeeQR covers the 200 (image/png) happy path plus two
// distinct-shape error branches: a 404 that masks BOTH "attendee doesn't exist"
// and "store failure loading it" identically (this handler loads via the plain,
// non-tenant-scoped Store.GetAttendeeByID, unlike every other attendee handler,
// which uses requireAttendeeOwnership), and a genuinely reachable 500 from
// qrcode.Encode rejecting a code too long to fit a QR symbol at this recovery
// level — not a mocked store error.
func TestContractGetAttendeeQR(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/qr"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id/qr")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.GetAttendeeQR(c); err != nil {
		t.Fatalf("GetAttendeeQR: %v", err)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("want image/png, got %s", ct)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: attendee does not exist (GetAttendeeByID returns nil, nil) — echo.NewHTTPError,
	// rendered like Echo would.
	hMissing := New(&fakeStore{
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id/qr")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := hMissing.GetAttendeeQR(c); err != nil {
		e.HTTPErrorHandler(err, c)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: qrcode.Encode fails because the code is too long to fit a QR symbol
	// at Medium recovery / 256px (empirically >~3300 bytes for this library).
	longCodeAttendee := contractAttendee(event.ID)
	longCodeAttendee.Code = strings.Repeat("A", 4000)
	hLongCode := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return longCodeAttendee, nil },
	})
	longPath := "/api/attendees/" + longCodeAttendee.ID.String() + "/qr"
	c, rec = newAuthedContext(e, http.MethodGet, longPath, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id/qr")
	c.SetParamNames("id")
	c.SetParamValues(longCodeAttendee.ID.String())
	if err := hLongCode.GetAttendeeQR(c); err != nil {
		e.HTTPErrorHandler(err, c)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

func TestContractUpdateAttendeeHandler(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	staffUser := contractUser("staff@org.io")
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	validateResponse(t, http.MethodPut, path, rec)
}

func TestContractUpdateAttendeeInfo(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodPatch, path, `{"company":"Acme"}`, tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.UpdateAttendeeInfo(c); err != nil {
		t.Fatalf("UpdateAttendeeInfo: %v", err)
	}
	validateResponse(t, http.MethodPatch, path, rec)

	// 404: attendee exists but belongs to a different tenant (requireAttendeeOwnership
	// masks "foreign" as "missing").
	c, rec = newAuthedContext(e, http.MethodPatch, path, `{"company":"Acme"}`, uuid.New().String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.UpdateAttendeeInfo(c); err != nil {
		t.Fatalf("UpdateAttendeeInfo (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPatch, path, rec)
}

func TestContractDeleteAttendee(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.DeleteAttendee(c); err != nil {
		t.Fatalf("DeleteAttendee: %v", err)
	}
	validateResponse(t, http.MethodDelete, path, rec)
}

func TestContractBlockAttendee(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/block"
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"reason":"No-show"}`, tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id/block")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.BlockAttendee(c); err != nil {
		t.Fatalf("BlockAttendee: %v", err)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractUnblockAttendee(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.Blocked = true
	reason := "No-show"
	attendee.BlockReason = &reason
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
	})
	e := echo.New()
	path := "/api/attendees/" + attendee.ID.String() + "/unblock"
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	c.SetPath("/api/attendees/:id/unblock")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())
	if err := h.UnblockAttendee(c); err != nil {
		t.Fatalf("UnblockAttendee: %v", err)
	}
	validateResponse(t, http.MethodPost, path, rec)
}
