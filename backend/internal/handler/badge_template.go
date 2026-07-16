package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"idento/backend/internal/store"
	"idento/backend/internal/zpl"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// BadgeTemplateResponse is the response body for GET/PUT
// /api/events/{id}/badge-template. Template is nil (serializes to JSON
// null) when the event has no template saved yet, in which case Version
// is 0.
type BadgeTemplateResponse struct {
	Template json.RawMessage `json:"template"`
	Version  int             `json:"version"`
}

// BadgeTemplatePutRequest is the request body for PUT
// /api/events/{id}/badge-template. Version is a pointer so a missing
// "version" key (nil) can be distinguished from an explicit 0 (a valid,
// required value meaning "no template saved yet").
type BadgeTemplatePutRequest struct {
	Template json.RawMessage `json:"template"`
	Version  *int            `json:"version"`
}

// BadgeTemplateConflict is the 409 body for PUT /api/events/{id}/badge-template
// when the caller's version no longer matches the event's stored version.
type BadgeTemplateConflict struct {
	Error          string `json:"error"`
	CurrentVersion int    `json:"current_version"`
}

// GetBadgeTemplate returns the event's badge template (verbatim JSON) and
// its optimistic-concurrency version. template is null / version is 0
// when the event has never had a template saved.
func (h *Handler) GetBadgeTemplate(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ownership must be established before any store call: GetEventBadgeTemplate
	// collapses "no such event" and "no template yet" into the same zero
	// value, so calling it first would mask a foreign/deleted event as an
	// empty-template 200 instead of 404.
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	template, version, err := h.Store.GetEventBadgeTemplate(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load badge template"})
	}

	return c.JSON(http.StatusOK, BadgeTemplateResponse{Template: template, Version: version})
}

// PutBadgeTemplate saves the event's badge template under an
// optimistic-concurrency guard. Storage is verbatim: the persisted bytes
// are the request's raw "template" JSON, untouched — only a parsed COPY is
// validated via zpl.ParseBadgeTemplate, so unknown keys (e.g. a panel-only
// customFont) survive a round trip.
func (h *Handler) PutBadgeTemplate(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ownership first (see GetBadgeTemplate's comment): UpdateEventBadgeTemplate's
	// guarded UPDATE doesn't distinguish "no such event" from "stale
	// version" — both are a 0-row result — so a deleted/foreign event must
	// be caught here as a 404, not surfaced later as a misleading 409.
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req BadgeTemplatePutRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if req.Version == nil || *req.Version < 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "version is required and must be >= 0"})
	}
	if len(req.Template) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "template is required"})
	}

	// Validate a parsed COPY of the raw bytes; req.Template itself (the
	// exact bytes the client sent) is what gets persisted below, never
	// this decoded/re-encoded value.
	var parsed interface{}
	if err := json.Unmarshal(req.Template, &parsed); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid template JSON: " + err.Error()})
	}
	if _, ok := parsed.(map[string]interface{}); !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "template must be a JSON object"})
	}
	if _, _, err := zpl.ParseBadgeTemplate(parsed); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid badge template: " + err.Error()})
	}

	newVersion, err := h.Store.UpdateEventBadgeTemplate(c.Request().Context(), eventID, req.Template, *req.Version)
	if err != nil {
		if errors.Is(err, store.ErrVersionConflict) {
			_, currentVersion, gerr := h.Store.GetEventBadgeTemplate(c.Request().Context(), eventID)
			if gerr != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load current badge template version"})
			}
			return c.JSON(http.StatusConflict, BadgeTemplateConflict{
				Error:          "Badge template version conflict",
				CurrentVersion: currentVersion,
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save badge template"})
	}

	return c.JSON(http.StatusOK, BadgeTemplateResponse{Template: req.Template, Version: newVersion})
}
