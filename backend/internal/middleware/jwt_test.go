package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestJWT_RejectsWhenSecretUnset(t *testing.T) {
	t.Setenv("JWT_SECRET", "") // no secret configured
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// A token signed with the old hardcoded fallback must NOT be accepted.
	req.Header.Set("Authorization", "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."+
		"eyJ1c2VyX2lkIjoieCIsInRlbmFudF9pZCI6IngiLCJyb2xlIjoiYWRtaW4ifQ."+
		"3Qb0m0f8Zk5m3d8n2r7Xv3nJ5xq0Yl1a2b3c4d5e6f") // signed with idento_secret_key_change_me
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	called := false
	h := JWT()(func(c echo.Context) error { called = true; return nil })
	_ = h(c)

	if called {
		t.Fatal("handler must NOT be reached when JWT_SECRET is unset")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
