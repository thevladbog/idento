// Package httpauth guards the local printer agent's HTTP endpoints: it binds
// authorization to a loopback Host, requires JSON content-type on mutations,
// and accepts either a shared bearer token (desktop) or an allow-listed Origin
// (browser web app).
package httpauth

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
)

type Authorizer struct {
	token          string
	allowedOrigins map[string]struct{}
}

// New builds an Authorizer. An empty token disables token auth (Origin-only).
func New(token string, origins []string) *Authorizer {
	set := make(map[string]struct{}, len(origins))
	for _, o := range origins {
		if o = strings.TrimSpace(o); o != "" {
			set[o] = struct{}{}
		}
	}
	return &Authorizer{token: token, allowedOrigins: set}
}

// authorize decides whether a request may proceed. ok==true means allow;
// otherwise status is the HTTP rejection code.
func (a *Authorizer) authorize(r *http.Request) (int, bool) {
	if r.URL.Path == "/health" {
		return http.StatusOK, true
	}
	if !isLoopbackHost(r.Host) {
		return http.StatusForbidden, false
	}
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			return http.StatusUnsupportedMediaType, false
		}
	}
	if a.validToken(r) || a.allowedOrigin(r) {
		return http.StatusOK, true
	}
	return http.StatusUnauthorized, false
}

func (a *Authorizer) validToken(r *http.Request) bool {
	if a.token == "" {
		return false
	}
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return false
	}
	got := strings.TrimPrefix(h, prefix)
	return subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) == 1
}

func (a *Authorizer) allowedOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return false
	}
	_, ok := a.allowedOrigins[o]
	return ok
}

func isLoopbackHost(host string) bool {
	h := host
	if hh, _, err := net.SplitHostPort(host); err == nil {
		h = hh
	}
	if strings.EqualFold(h, "localhost") {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// Middleware wraps next, rejecting unauthorized requests before they reach it.
func (a *Authorizer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status, ok := a.authorize(r); !ok {
			http.Error(w, http.StatusText(status), status)
			return
		}
		next.ServeHTTP(w, r)
	})
}
