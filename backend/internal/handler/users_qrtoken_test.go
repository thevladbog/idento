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

func TestGenerateQRToken_AdminCanMintForOtherActiveTenantMember(t *testing.T) {
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

func TestGenerateQRToken_StaffCanMintForSelf(t *testing.T) {
	e := echo.New()
	activeTenant := uuid.New()
	staffID := uuid.New()

	saved := false
	fs := &fakeStore{
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			if id != staffID {
				t.Fatalf("GetUserByID id = %v, want caller id %v", id, staffID)
			}
			return &models.User{ID: staffID, TenantID: activeTenant, Email: "staff@org.test"}, nil
		},
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			if userID != staffID || tenantID != activeTenant {
				t.Fatalf("GetUserTenantRole(%v, %v), want (%v, %v)", userID, tenantID, staffID, activeTenant)
			}
			return "staff", nil
		},
		updateUserQRToken: func(userID uuid.UUID, token string, _ time.Time) error {
			if userID != staffID {
				t.Fatalf("UpdateUserQRToken user id = %v, want %v", userID, staffID)
			}
			if token == "" {
				t.Fatal("UpdateUserQRToken received an empty token")
			}
			saved = true
			return nil
		},
	}
	h := &Handler{Store: fs}

	c, rec := newAuthedContextWithUserID(
		e,
		http.MethodPost,
		"/api/users/"+staffID.String()+"/qr-token",
		"",
		activeTenant.String(),
		staffID,
		"staff",
	)
	c.SetParamNames("id")
	c.SetParamValues(staffID.String())

	if err := h.GenerateQRToken(c); err != nil {
		t.Fatalf("GenerateQRToken returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !saved {
		t.Fatal("staff self-service mint did not persist a token")
	}

	var response struct {
		QRToken string `json:"qr_token"`
		UserID  string `json:"user_id"`
		Email   string `json:"email"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("invalid response JSON: %v", err)
	}
	if response.QRToken == "" || response.UserID != staffID.String() || response.Email != "staff@org.test" {
		t.Fatalf("response metadata = {token_present:%v user_id:%q email:%q}, want self-service QR response shape", response.QRToken != "", response.UserID, response.Email)
	}
}

func TestGenerateQRToken_StaffCannotMintForOtherUser(t *testing.T) {
	e := echo.New()
	activeTenant := uuid.New()
	callerID := uuid.New()
	targetID := uuid.New()
	storeCalled := false

	fs := &fakeStore{
		getUserByID: func(uuid.UUID) (*models.User, error) {
			storeCalled = true
			return nil, nil
		},
		updateUserQRToken: func(uuid.UUID, string, time.Time) error {
			storeCalled = true
			return nil
		},
	}
	h := &Handler{Store: fs}

	c, _ := newAuthedContextWithUserID(
		e,
		http.MethodPost,
		"/api/users/"+targetID.String()+"/qr-token",
		"",
		activeTenant.String(),
		callerID,
		"staff",
	)
	c.SetParamNames("id")
	c.SetParamValues(targetID.String())

	err := h.GenerateQRToken(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusForbidden {
		t.Fatalf("error = %v, want 403", err)
	}
	if storeCalled {
		t.Fatal("staff targeting another user reached the store or token write")
	}
}

func TestGenerateQRToken_ManagerCannotMintForAnyUser(t *testing.T) {
	e := echo.New()
	activeTenant := uuid.New()
	managerID := uuid.New()
	targetID := uuid.New()
	storeCalled := false

	fs := &fakeStore{
		getUserByID: func(uuid.UUID) (*models.User, error) {
			storeCalled = true
			return nil, nil
		},
		updateUserQRToken: func(uuid.UUID, string, time.Time) error {
			storeCalled = true
			return nil
		},
	}
	h := &Handler{Store: fs}

	c, _ := newAuthedContextWithUserID(
		e,
		http.MethodPost,
		"/api/users/"+targetID.String()+"/qr-token",
		"",
		activeTenant.String(),
		managerID,
		"manager",
	)
	c.SetParamNames("id")
	c.SetParamValues(targetID.String())

	err := h.GenerateQRToken(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusForbidden {
		t.Fatalf("error = %v, want 403", err)
	}
	if storeCalled {
		t.Fatal("manager QR mint reached the store or token write")
	}
}

// Non-members get a uniform 404 — a 403 would reveal the user exists in
// another tenant (PR #23 review).
func TestGenerateQRTokenNonMemberIs404(t *testing.T) {
	e := echo.New()
	targetID := uuid.New()

	fs := &fakeStore{
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: targetID, TenantID: uuid.New(), Email: "s@x.y"}, nil
		},
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			return "", nil // not a member of the caller's active tenant
		},
	}
	h := &Handler{Store: fs}

	c, _ := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(targetID.String())

	err := h.GenerateQRToken(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %v", err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Errorf("code = %d, want 404 (uniform not-found, no existence leak)", httpErr.Code)
	}
}
