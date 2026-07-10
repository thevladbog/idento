package handler

import (
	"net/http"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/labstack/echo/v4"
)

func TestSystemAnalyticsReturnsAggregates(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getPlatformAnalytics: func() (*models.PlatformAnalytics, error) {
			return &models.PlatformAnalytics{
				TenantsByStatus: map[string]int{"active": 3, "suspended": 1},
				TotalTenants:    4,
				PaidTenants:     1,
				PaidConversion:  0.25,
			}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", "", "admin")
	if err := h.GetSystemAnalytics(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tenants_by_status"`) {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "coming soon") {
		t.Fatal("stub response still present")
	}
}
