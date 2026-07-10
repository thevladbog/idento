package handler

import (
	"net/http"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// httpError carries an HTTP status and a message for authz helpers; handlers
// render it via writeErr to keep the {"error": msg} response shape.
type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }

func newHTTPError(status int, msg string) *httpError { return &httpError{status: status, msg: msg} }

// writeErr renders an *httpError as {"error": msg} with its status; anything
// else becomes a 500. Handlers call: if err != nil { return writeErr(c, err) }.
func writeErr(c echo.Context, err error) error {
	if he, ok := err.(*httpError); ok {
		return c.JSON(he.status, map[string]string{"error": he.msg})
	}
	return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal error"})
}

// tenantIDFromContext parses the caller's tenant UUID from JWT claims set by middleware.JWT.
func tenantIDFromContext(c echo.Context) (uuid.UUID, error) {
	claims, ok := c.Get("user").(*models.JWTCustomClaims)
	if !ok || claims == nil {
		return uuid.Nil, newHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	tenantID, err := uuid.Parse(claims.TenantID)
	if err != nil {
		return uuid.Nil, newHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	return tenantID, nil
}

// requireEventOwnership loads the event scoped to the caller's tenant.
// Missing and foreign events are both 404 — no existence oracle.
func (h *Handler) requireEventOwnership(c echo.Context, eventID uuid.UUID) (*models.Event, error) {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return nil, err
	}
	event, err := h.Store.GetEventByIDForTenant(c.Request().Context(), eventID, tenantID)
	if err != nil || event == nil {
		return nil, newHTTPError(http.StatusNotFound, "Event not found")
	}
	return event, nil
}

// requireAttendeeOwnership loads the attendee scoped to the caller's tenant
// (via its event). Missing and foreign are both 404.
func (h *Handler) requireAttendeeOwnership(c echo.Context, attendeeID uuid.UUID) (*models.Attendee, error) {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return nil, err
	}
	attendee, err := h.Store.GetAttendeeByIDForTenant(c.Request().Context(), attendeeID, tenantID)
	if err != nil || attendee == nil {
		return nil, newHTTPError(http.StatusNotFound, "Attendee not found")
	}
	return attendee, nil
}

// requireZoneOwnership resolves a zone to its event and verifies tenant ownership.
func (h *Handler) requireZoneOwnership(c echo.Context, zoneID uuid.UUID) (*models.EventZone, *models.Event, error) {
	zone, err := h.Store.GetEventZoneByID(c.Request().Context(), zoneID)
	if err != nil || zone == nil {
		return nil, nil, newHTTPError(http.StatusNotFound, "Zone not found")
	}
	event, err := h.requireEventOwnership(c, zone.EventID)
	if err != nil {
		return nil, nil, err
	}
	return zone, event, nil
}
