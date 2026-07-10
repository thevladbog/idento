package httpauth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func newReq(method, target, host, origin, contentType, auth string) *http.Request {
	r := httptest.NewRequest(method, target, nil)
	r.Host = host
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	return r
}

func TestAuthorize(t *testing.T) {
	a := New("secret-token-abc", []string{"http://localhost:5173"})

	cases := []struct {
		name   string
		req    *http.Request
		want   int
		wantOK bool
	}{
		{"health without auth", newReq("GET", "/health", "127.0.0.1:12345", "", "", ""), http.StatusOK, true},
		{"GET with allowlisted origin", newReq("GET", "/printers", "127.0.0.1:12345", "http://localhost:5173", "", ""), http.StatusOK, true},
		{"GET with valid token", newReq("GET", "/printers", "127.0.0.1:12345", "", "", "Bearer secret-token-abc"), http.StatusOK, true},
		{"POST json with token", newReq("POST", "/print", "127.0.0.1:12345", "", "application/json", "Bearer secret-token-abc"), http.StatusOK, true},
		{"POST json with allowlisted origin", newReq("POST", "/print", "127.0.0.1:12345", "http://localhost:5173", "application/json", ""), http.StatusOK, true},
		{"no auth at all", newReq("GET", "/printers", "127.0.0.1:12345", "", "", ""), http.StatusUnauthorized, false},
		{"foreign origin", newReq("GET", "/printers", "127.0.0.1:12345", "http://evil.example.com", "", ""), http.StatusUnauthorized, false},
		{"wrong token", newReq("GET", "/printers", "127.0.0.1:12345", "", "", "Bearer nope"), http.StatusUnauthorized, false},
		{"non-loopback host", newReq("GET", "/printers", "evil.example.com", "http://localhost:5173", "", "Bearer secret-token-abc"), http.StatusForbidden, false},
		{"POST without json content-type", newReq("POST", "/print", "127.0.0.1:12345", "http://localhost:5173", "text/plain", ""), http.StatusUnsupportedMediaType, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, ok := a.authorize(c.req)
			if ok != c.wantOK || status != c.want {
				t.Fatalf("authorize() = (%d, %v), want (%d, %v)", status, ok, c.want, c.wantOK)
			}
		})
	}
}

func TestMiddleware_RejectsUnauthorized(t *testing.T) {
	a := New("tok", []string{"http://localhost:5173"})
	called := false
	h := a.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newReq("GET", "/printers", "127.0.0.1:12345", "", "", ""))
	if called {
		t.Fatal("next handler must not be called for unauthorized request")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}
