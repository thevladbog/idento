// Package httpauth guards the local printer agent's HTTP endpoints: a valid
// shared bearer token (desktop) always authorizes a request; otherwise, for
// browser (Origin-based) clients, it binds authorization to a loopback Host,
// requires JSON content-type on mutations, and requires an allow-listed
// Origin.
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
//
// A valid bearer token authorizes the request regardless of Host: the token
// is a strong secret that lives only in the agent's 0600 config file and is
// never exposed to a browser, so it does not need the loopback-Host,
// Content-Type, or Origin protections that guard the browser (Origin-based)
// auth path below. Those protections (anti-DNS-rebind, anti-CSRF) only apply
// once we fall through to the no-token path.
func (a *Authorizer) authorize(r *http.Request) (int, bool) {
	// /docs and /openapi.yaml are exempt alongside /health: both are
	// read-only and non-sensitive (the spec is committed to the repo, the
	// docs page is static HTML), and a browser navigating directly sends no
	// Origin header, so they would otherwise always 401. The agent's
	// loopback bind remains the effective protection.
	switch r.URL.Path {
	case "/health", "/docs", "/openapi.yaml":
		return http.StatusOK, true
	}
	if a.validToken(r) {
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
	if a.allowedOrigin(r) {
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
