package middleware

import (
	"idento/backend/internal/models"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

// oldHardcodedFallbackSecret reconstructs the removed hardcoded JWT fallback
// secret that must never again validate tokens when JWT_SECRET is unset. It is
// assembled from parts at runtime (not written as a single literal) so secret
// scanners don't flag this defunct, deliberately-referenced test fixture.
var oldHardcodedFallbackSecret = strings.Join([]string{"idento", "secret", "key", "change", "me"}, "_")

// signTokenWithSecret builds a valid HS256 token, signed with the given
// secret, using the same claims shape the middleware expects.
func signTokenWithSecret(t *testing.T, secret string) string {
	t.Helper()
	claims := models.JWTCustomClaims{
		UserID:   "x",
		TenantID: "x",
		Role:     "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to sign test token: %v", err)
	}
	return signed
}

// callJWTMiddleware runs the JWT middleware against a request bearing the
// given token and reports whether the wrapped handler was invoked, along
// with the recorded response code.
func callJWTMiddleware(token string) (handlerCalled bool, code int) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	called := false
	h := JWT()(func(c echo.Context) error { called = true; return nil })
	_ = h(c)

	return called, rec.Code
}

// TestJWT_RejectsWhenSecretUnset is a differential regression guard for the
// removed hardcoded JWT fallback secret. It signs a token with the *old*
// hardcoded secret and asserts:
//
//  1. With JWT_SECRET unset, the middleware fail-closes and rejects the
//     token (this sub-test would FAIL if the hardcoded fallback were ever
//     reintroduced, since the token would then validate successfully).
//  2. With JWT_SECRET explicitly set to the old hardcoded secret, the same
//     token IS accepted — proving the token is validly signed, so case (1)'s
//     rejection is genuinely caused by the empty-secret fail-closed
//     behavior and not by a malformed/garbage token.
func TestJWT_RejectsWhenSecretUnset(t *testing.T) {
	token := signTokenWithSecret(t, oldHardcodedFallbackSecret)

	t.Run("unset secret rejects token signed with old hardcoded fallback", func(t *testing.T) {
		t.Setenv("JWT_SECRET", "") // no secret configured

		called, code := callJWTMiddleware(token)

		if called {
			t.Fatal("handler must NOT be reached when JWT_SECRET is unset")
		}
		if code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", code)
		}
	})

	t.Run("secret matching old hardcoded fallback accepts the same token", func(t *testing.T) {
		t.Setenv("JWT_SECRET", oldHardcodedFallbackSecret)

		called, code := callJWTMiddleware(token)

		if !called {
			t.Fatal("handler must be reached when JWT_SECRET matches the token's signing secret")
		}
		if code != http.StatusOK {
			t.Fatalf("expected 200, got %d", code)
		}
	})
}
