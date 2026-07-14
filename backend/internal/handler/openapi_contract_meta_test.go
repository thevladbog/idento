package handler

import (
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestContractHealth(t *testing.T) {
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodGet, "/health", "")
	if err := Health(c); err != nil {
		t.Fatalf("Health: %v", err)
	}
	validateResponse(t, http.MethodGet, "/health", rec)
}

func TestContractInstance(t *testing.T) {
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodGet, "/api/instance", "")
	if err := Instance("saas", "v1.2.3")(c); err != nil {
		t.Fatalf("Instance: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/instance", rec)
}
