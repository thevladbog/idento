package handler

import (
	"net/http"
	"testing"

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
