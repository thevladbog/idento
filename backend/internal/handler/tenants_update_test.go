package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TestUpdateTenantRejectsEmptyName closes the P1-era backlog item "backend
// UpdateTenant should reject empty name server-side": `{"name": ""}` (or a
// whitespace-only name) used to blank the tenant's name straight into the
// store, since the handler copied *req.Name without any validation. The
// tenant name is identity-bearing (console lists, audit rendering, badge
// headers), so an empty value is a client error, not an update.
func TestUpdateTenantRejectsEmptyName(t *testing.T) {
	newHandler := func(updated *[]*models.Tenant) (*Handler, *models.Tenant) {
		tenant := &models.Tenant{ID: uuid.New(), Name: "Acme"}
		h := New(&fakeStore{
			getUserTenantRole: func(_, _ uuid.UUID) (string, error) { return "admin", nil },
			getTenantByID:     func(uuid.UUID) (*models.Tenant, error) { return tenant, nil },
			updateTenant: func(tn *models.Tenant) error {
				*updated = append(*updated, tn)
				return nil
			},
		})
		return h, tenant
	}

	run := func(t *testing.T, body string) (*[]*models.Tenant, *models.Tenant, int) {
		t.Helper()
		var updated []*models.Tenant
		h, tenant := newHandler(&updated)
		e := echo.New()
		c, rec := newAuthedContext(e, http.MethodPut, "/api/tenants/"+tenant.ID.String(),
			body, tenant.ID.String(), "admin")
		c.SetPath("/api/tenants/:id")
		c.SetParamNames("id")
		c.SetParamValues(tenant.ID.String())
		if err := h.UpdateTenant(c); err != nil {
			t.Fatalf("UpdateTenant: %v", err)
		}
		return &updated, tenant, rec.Code
	}

	t.Run("empty name is a 400 and never reaches the store", func(t *testing.T) {
		updated, tenant, code := run(t, `{"name":""}`)
		if code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", code, http.StatusBadRequest)
		}
		if len(*updated) != 0 {
			t.Fatal("store UpdateTenant was called for an empty name")
		}
		if tenant.Name != "Acme" {
			t.Fatalf("tenant name mutated to %q", tenant.Name)
		}
	})

	t.Run("whitespace-only name is a 400 and never reaches the store", func(t *testing.T) {
		updated, _, code := run(t, `{"name":"   "}`)
		if code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", code, http.StatusBadRequest)
		}
		if len(*updated) != 0 {
			t.Fatal("store UpdateTenant was called for a whitespace-only name")
		}
	})

	t.Run("a valid name is trimmed before persisting", func(t *testing.T) {
		updated, _, code := run(t, `{"name":"  Acme Renamed  "}`)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want %d", code, http.StatusOK)
		}
		if len(*updated) != 1 || (*updated)[0].Name != "Acme Renamed" {
			t.Fatalf("persisted name = %+v, want one update with trimmed name", *updated)
		}
	})

	t.Run("omitting name still updates other fields (no new required-field regression)", func(t *testing.T) {
		updated, _, code := run(t, `{"website":"https://acme.example"}`)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want %d", code, http.StatusOK)
		}
		if len(*updated) != 1 || (*updated)[0].Name != "Acme" {
			t.Fatalf("persisted = %+v, want one update keeping the existing name", *updated)
		}
		if w := (*updated)[0].Website; w == nil || *w != "https://acme.example" {
			t.Fatal("website was not updated")
		}
	})
}
