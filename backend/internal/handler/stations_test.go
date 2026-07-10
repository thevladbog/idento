package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/config"
	"idento/backend/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestCreateStationProvisioningToken_RequiresManagerRole(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/stations/provisioning-token", `{"staff_user_id":"`+uuid.New().String()+`"}`, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateStationProvisioningToken(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-manager role, got %d", rec.Code)
	}
}

func TestCreateStationProvisioningToken_ForeignTenantStaffUser404(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	staffID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: id}, nil
		},
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) {
			return "", nil // not a member of this tenant
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/stations/provisioning-token", `{"staff_user_id":"`+staffID.String()+`"}`, tenantID.String(), "manager")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateStationProvisioningToken(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for staff user outside caller's tenant, got %d", rec.Code)
	}
}

// TestCreateStationProvisioningToken_RejectsAdminTargetRole guards against a
// shared physical station device authenticating as a full tenant admin: a
// manager confirming real tenant membership isn't enough, the target's
// tenant-scoped role must also be staff/manager (not admin).
func TestCreateStationProvisioningToken_RejectsAdminTargetRole(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	staffID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: id}, nil
		},
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) {
			return "admin", nil // real tenant member, but an admin
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/stations/provisioning-token", `{"staff_user_id":"`+staffID.String()+`"}`, tenantID.String(), "manager")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateStationProvisioningToken(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when target staff user's tenant role is admin, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProvisionStation_InvalidTokenReturns401(t *testing.T) {
	fs := &fakeStore{
		consumeProvisioningToken: func(_ string) (*models.StationProvisioningToken, error) {
			return nil, nil // expired, consumed, or unknown
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/api/stations/provision", `{"token":"bogus"}`)
	if err := h.ProvisionStation(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", rec.Code)
	}
}

func TestProvisionStation_ValidTokenIssuesJWTAndDeviceNumber(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret") // generateTokenForTenant requires this to be set
	eventID := uuid.New()
	tenantID := uuid.New()
	staffID := uuid.New()
	fs := &fakeStore{
		consumeProvisioningToken: func(_ string) (*models.StationProvisioningToken, error) {
			return &models.StationProvisioningToken{Token: "tok", EventID: eventID, StaffUserID: staffID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID, Name: "Технопром-2026"}, nil
		},
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			// Global role is "staff", but the user's tenant-scoped role for
			// THIS event's tenant (below) is "manager" — the JWT must reflect
			// the tenant-scoped role, not this global one (MOBILE/PR27 finding 6).
			return &models.User{ID: id, Email: "staff@idento.app", Role: "staff"}, nil
		},
		getUserTenantRole: func(_, gotTenantID uuid.UUID) (string, error) {
			if gotTenantID != tenantID {
				t.Fatalf("GetUserTenantRole called with tenant %v, want %v", gotTenantID, tenantID)
			}
			return "manager", nil
		},
		createStation: func(_, _ uuid.UUID, _ map[string]interface{}) (*models.Station, error) {
			return &models.Station{ID: uuid.New(), EventID: eventID, DeviceNumber: 3}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/api/stations/provision", `{"token":"tok"}`)
	if err := h.ProvisionStation(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp models.ProvisionStationResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resp.DeviceNumber != 3 || resp.StationConfig.EventName != "Технопром-2026" || resp.StaffJWT == "" {
		t.Fatalf("unexpected response: %+v", resp)
	}

	claims := &models.JWTCustomClaims{}
	token, err := jwt.ParseWithClaims(resp.StaffJWT, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(config.JWTSecret()), nil
	})
	if err != nil || !token.Valid {
		t.Fatalf("failed to parse/validate StaffJWT: %v", err)
	}
	if claims.TenantID != tenantID.String() {
		t.Errorf("JWT tenant_id = %q, want %q", claims.TenantID, tenantID.String())
	}
	if claims.Role != "manager" {
		t.Errorf("JWT role = %q, want %q (must be the tenant-scoped role from GetUserTenantRole, not the user's global role \"staff\")", claims.Role, "manager")
	}
	if claims.UserID != staffID.String() {
		t.Errorf("JWT user_id = %q, want %q", claims.UserID, staffID.String())
	}
}
