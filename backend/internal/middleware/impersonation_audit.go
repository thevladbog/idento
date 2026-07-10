package middleware

import (
	"log"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// ImpersonationAudit writes an audit row for every mutating request made
// under an impersonation token (imp_by claim), attributing it to the
// operator. Best-effort: an audit failure never blocks the request — the
// mint event was already logged, and availability wins here.
func ImpersonationAudit(s store.Store) echo.MiddlewareFunc {
	mutating := map[string]bool{"POST": true, "PUT": true, "PATCH": true, "DELETE": true}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get("user").(*models.JWTCustomClaims)
			if ok && claims != nil && claims.ImpersonatedBy != "" && mutating[c.Request().Method] {
				adminID, err := uuid.Parse(claims.ImpersonatedBy)
				tenantID, terr := uuid.Parse(claims.TenantID)
				if err == nil && terr == nil {
					if err := s.LogAdminAction(c.Request().Context(), adminID, "impersonated_request", "tenant", tenantID, map[string]interface{}{
						"method": c.Request().Method,
						"path":   c.Request().URL.Path,
					}, c.RealIP(), c.Request().UserAgent()); err != nil {
						log.Printf("impersonation audit failed (%s %s): %v", c.Request().Method, c.Request().URL.Path, err)
					}
				}
			}
			return next(c)
		}
	}
}
