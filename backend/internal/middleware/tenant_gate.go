package middleware

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TenantGate blocks requests for suspended/archived tenants and lapsed
// subscriptions with a machine-readable body, so every client (web, mobile,
// kiosk) can render "organization suspended" instead of a generic error.
// Decisions are cached per tenant for 2 minutes to avoid a DB hit per request.
func TenantGate(s store.Store) echo.MiddlewareFunc {
	return tenantGateWithTTL(s, 2*time.Minute)
}

type gateEntry struct {
	blocked bool
	expires time.Time
}

// sweepExpiredLocked removes expired entries; callers hold the write lock.
// Bounded work: runs only when the cache exceeds maxGateCacheEntries, which
// caps memory at roughly the live-tenant cardinality.
const maxGateCacheEntries = 1024

func sweepExpiredLocked(cache map[string]gateEntry, now time.Time) {
	for k, v := range cache {
		if now.After(v.expires) {
			delete(cache, k)
		}
	}
}

func tenantGateWithTTL(s store.Store, ttl time.Duration) echo.MiddlewareFunc {
	var (
		mu    sync.RWMutex
		cache = map[string]gateEntry{}
	)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path
			// Exempt: the caller must still be able to see who they are and
			// (in SaaS) platform operators must never be locked out.
			if path == "/api/me" || strings.HasPrefix(path, "/api/super-admin") {
				return next(c)
			}
			claims, ok := c.Get("user").(*models.JWTCustomClaims)
			if !ok || claims == nil {
				return next(c) // not a tenant-scoped request (JWT middleware guards auth)
			}

			if ttl > 0 {
				mu.RLock()
				entry, hit := cache[claims.TenantID]
				mu.RUnlock()
				if hit && time.Now().Before(entry.expires) {
					if entry.blocked {
						return blockedResponse(c)
					}
					return next(c)
				}
			}

			tenantID, err := uuid.Parse(claims.TenantID)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
			}
			blocked, err := IsTenantBlocked(c.Request().Context(), s, tenantID)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify tenant status"})
			}
			if ttl > 0 {
				mu.Lock()
				if len(cache) >= maxGateCacheEntries {
					sweepExpiredLocked(cache, time.Now())
				}
				cache[claims.TenantID] = gateEntry{blocked: blocked, expires: time.Now().Add(ttl)}
				mu.Unlock()
			}
			if blocked {
				return blockedResponse(c)
			}
			return next(c)
		}
	}
}

// IsTenantBlocked reports whether a tenant should be blocked (suspended,
// archived, or with a lapsed subscription). It is exported so non-gate
// entry points that bypass JWT + TenantGate — e.g. API-key authenticated
// routes — can apply the same suspension check.
func IsTenantBlocked(ctx context.Context, s store.Store, tenantID uuid.UUID) (bool, error) {
	status, err := s.GetTenantStatus(ctx, tenantID)
	if err != nil {
		return false, err
	}
	if status != "active" { // suspended, archived, or missing ("")
		return true, nil
	}
	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil || sub == nil {
		// No subscription → the limits middleware already rejects creation;
		// don't hard-lock reads over it. Errors fail open here by design:
		// availability of the whole API must not hinge on the billing table.
		return false, nil
	}
	switch sub.Status {
	case "expired", "cancelled":
		return true, nil
	}
	if sub.EndDate != nil && time.Now().After(*sub.EndDate) && sub.Status != "active" {
		return true, nil
	}
	return false, nil
}

func blockedResponse(c echo.Context) error {
	return c.JSON(http.StatusForbidden, map[string]string{
		"code":  "tenant_suspended",
		"error": "This organization is suspended. Contact support.",
	})
}
