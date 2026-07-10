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
	secret := "super-secret-qr-token"
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
