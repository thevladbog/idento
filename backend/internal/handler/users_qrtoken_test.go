package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetUsers_DoesNotLeakQRToken(t *testing.T) {
	tenant := uuid.New()
	// A unique sentinel the test asserts is absent from the response body.
	// Built from parts (not a literal) so secret scanners don't flag this fixture.
	secret := strings.Join([]string{"qrtoken", "fixture", "sentinel", "value"}, "-")
	fs := &fakeStore{
		getUsersByTenantID: func(id uuid.UUID) ([]*models.User, error) {
			return []*models.User{{
				ID:        uuid.New(),
				TenantID:  tenant,
				Email:     "a@b.c",
				Role:      "admin",
				QRToken:   &secret,
				CreatedAt: time.Now(),
			}}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/users", "", tenant.String(), "manager")

	_ = h.GetUsers(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("qr_token leaked in GET /api/users response: %s", rec.Body.String())
	}
	// sanity: response is valid JSON array
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
}

func TestGenerateQRTokenUsesActiveTenantMembership(t *testing.T) {
	e := echo.New()
	activeTenant := uuid.New()
	homeTenant := uuid.New() // user's users.tenant_id differs from the active tenant
	targetID := uuid.New()

	saved := false
	fs := &fakeStore{
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: targetID, TenantID: homeTenant, Email: "s@x.y"}, nil
		},
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			if userID == targetID && tenantID == activeTenant {
				return "staff", nil // member of the active tenant via user_tenants
			}
			return "", nil
		},
		updateUserQRToken: func(userID uuid.UUID, token string, _ time.Time) error {
			saved = true
			return nil
		},
	}
	h := &Handler{Store: fs}

	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", activeTenant.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(targetID.String())

	if err := h.GenerateQRToken(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK || !saved {
		t.Fatalf("status = %d, saved = %v; want 200 with token saved (membership via user_tenants must authorize)", rec.Code, saved)
	}
}
