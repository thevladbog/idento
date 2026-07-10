package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/middleware"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestCreateAPIKey_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/", `{"name":"x"}`, caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.CreateAPIKey(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// TestRevokeAPIKey_ForbidsRevokingKeyOfAnotherEvent guards against a
// cross-event IDOR: the caller legitimately owns eventID (their own tenant),
// but the key_id path param references a key that belongs to a different
// event entirely. Without a same-event check, RevokeAPIKey would revoke any
// key in the system as long as the caller owns *some* event, letting one
// tenant destroy another tenant's integration key. The handler must reject
// this before ever calling Store.RevokeAPIKey.
func TestRevokeAPIKey_ForbidsRevokingKeyOfAnotherEvent(t *testing.T) {
	tenant := uuid.New()
	ownedEventID := uuid.New()
	foreignKeyID := uuid.New() // belongs to some other event, not ownedEventID

	revokeCalled := false
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
		getAPIKeysByEventID: func(eventID uuid.UUID) ([]*models.APIKey, error) {
			// The owned event has its own keys, but none matching foreignKeyID.
			return []*models.APIKey{{ID: uuid.New(), EventID: eventID}}, nil
		},
		revokeAPIKey: func(id uuid.UUID) error {
			revokeCalled = true
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodDelete, "/", "", tenant.String(), "admin")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(ownedEventID.String(), foreignKeyID.String())

	_ = h.RevokeAPIKey(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	if revokeCalled {
		t.Fatal("expected Store.RevokeAPIKey NOT to be called for a key outside the owned event")
	}
}

// TestRevokeAPIKey_AllowsRevokingOwnKey is the happy-path complement: a key
// that genuinely belongs to the caller's owned event must still be
// revocable, so the new same-event check doesn't over-block legitimate use.
func TestRevokeAPIKey_AllowsRevokingOwnKey(t *testing.T) {
	tenant := uuid.New()
	ownedEventID := uuid.New()
	ownKeyID := uuid.New()

	revokeCalled := false
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
		getAPIKeysByEventID: func(eventID uuid.UUID) ([]*models.APIKey, error) {
			return []*models.APIKey{{ID: ownKeyID, EventID: eventID}}, nil
		},
		revokeAPIKey: func(id uuid.UUID) error {
			revokeCalled = true
			if id != ownKeyID {
				t.Fatalf("expected revoke of %s, got %s", ownKeyID, id)
			}
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodDelete, "/", "", tenant.String(), "admin")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(ownedEventID.String(), ownKeyID.String())

	_ = h.RevokeAPIKey(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !revokeCalled {
		t.Fatal("expected Store.RevokeAPIKey to be called for a key belonging to the owned event")
	}
}

// TestExternalImportRejectsOverLimitBatch mirrors
// TestBulkImportRejectsOverLimitBatch (tenant_isolation_test.go) but for the
// public API-key import route (POST /api/external/import). ExternalImport
// derives its event from the API-key context that middleware.APIKeyAuth
// populates (EventIDKey), not from JWT claims, so the fixture sets that
// context key directly instead of going through newAuthedContext.
func TestExternalImportRejectsOverLimitBatch(t *testing.T) {
	e := echo.New()
	tenant := uuid.New()
	eventID := uuid.New()

	checkAttendeeLimitCalled := false
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenant}, nil
		},
		getTenantStatus: func(id uuid.UUID) (string, error) {
			return "active", nil
		},
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return &models.Subscription{Status: "active"}, nil
		},
		checkAttendeeLimit: func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
			checkAttendeeLimitCalled = true
			return false, 45, 50, nil
		},
	}
	h := &Handler{Store: fs}

	body := `{"data":[` +
		`{"first_name":"a","last_name":"b","email":"a@x.com"},` +
		`{"first_name":"c","last_name":"d","email":"c@x.com"}` +
		`]}`
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(string(middleware.EventIDKey), eventID)

	if err := h.ExternalImport(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (batch over limit); body: %s", rec.Code, rec.Body.String())
	}
	if !checkAttendeeLimitCalled {
		t.Fatal("expected Store.CheckAttendeeLimit to be called")
	}
	// fakeStore has no createAttendee override, so if the handler fell
	// through to the creation loop despite the limit being exceeded, this
	// test would panic on a nil embedded Store.CreateAttendee call rather
	// than merely fail the status assertion above.
}

// TestExternalImportBlocksSuspendedTenant guards MOBILE-SEC/P1.2's other
// half: the API-key import path bypasses JWT + TenantGate entirely (it
// authenticates via middleware.APIKeyAuth, not a JWT), so a suspended
// tenant's still-valid API key could otherwise keep importing attendees
// after the org was locked out of every JWT-authed route. ExternalImport
// must apply the same suspension check TenantGate applies elsewhere, before
// ever reaching the attendee-limit check or the creation loop.
func TestExternalImportBlocksSuspendedTenant(t *testing.T) {
	e := echo.New()
	tenant := uuid.New()
	eventID := uuid.New()

	checkAttendeeLimitCalled := false
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenant}, nil
		},
		getTenantStatus: func(id uuid.UUID) (string, error) {
			return "suspended", nil
		},
		checkAttendeeLimit: func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
			checkAttendeeLimitCalled = true
			return true, 0, 50, nil
		},
	}
	h := &Handler{Store: fs}

	body := `{"data":[{"first_name":"a","last_name":"b","email":"a@x.com"}]}`
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(string(middleware.EventIDKey), eventID)

	if err := h.ExternalImport(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (suspended tenant); body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"tenant_suspended"`) {
		t.Errorf("body %q missing machine-readable code", rec.Body.String())
	}
	if checkAttendeeLimitCalled {
		t.Fatal("expected Store.CheckAttendeeLimit NOT to be called once the tenant is known to be suspended")
	}
	// fakeStore has no createAttendee override, so if the handler fell
	// through to the creation loop despite the tenant being suspended, this
	// test would panic on a nil embedded Store.CreateAttendee call rather
	// than merely fail the status assertion above.
}
