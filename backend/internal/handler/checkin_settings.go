package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CheckinSettingsResponse is the response body for GET/PUT
// /api/events/{id}/checkin-settings. Settings is nil (serializes to JSON
// null) when the event has no check-in settings saved yet — mirrors
// BadgeTemplateResponse's null-until-saved contract, minus the version
// (check-in settings are operator-only config with no concurrent-editor
// conflict class to guard against).
type CheckinSettingsResponse struct {
	Settings json.RawMessage `json:"settings"`
}

// CheckinSettingsPutRequest is the request body for PUT
// /api/events/{id}/checkin-settings. Settings is stored verbatim (the
// exact raw bytes the client sent) after being validated against a parsed
// COPY — see validateCheckinSettings.
type CheckinSettingsPutRequest struct {
	Settings json.RawMessage `json:"settings"`
}

// checkinSettingsShape is the strict shape CheckinSettingsPutRequest.Settings
// must decode into: all four fields required (pointers so a missing key is
// distinguishable from an explicit zero value), unknown fields rejected —
// mirrors the openapi.yaml CheckinSettings schema's
// `additionalProperties: false`. It exists purely for validation; the raw
// request bytes (not a re-marshaling of this struct) are what gets
// persisted, matching PutBadgeTemplate's verbatim-storage contract.
type checkinSettingsShape struct {
	PrintOnCheckin        *bool   `json:"print_on_checkin"`
	VerdictAutoDismissSec *int    `json:"verdict_auto_dismiss_sec"`
	ScanInput             *string `json:"scan_input"`
	ManualSearchEnabled   *bool   `json:"manual_search_enabled"`
}

// validCheckinScanInputs enumerates the only accepted values of
// checkinSettingsShape.ScanInput (openapi.yaml CheckinSettings.scan_input
// enum).
var validCheckinScanInputs = map[string]bool{
	"wedge":   true,
	"scanner": true,
	"manual":  true,
}

// validateCheckinSettings decodes raw into checkinSettingsShape (rejecting
// unknown fields) and checks field-level constraints: all four fields
// present, verdict_auto_dismiss_sec in [1, 30], scan_input one of
// wedge/scanner/manual. Returns a non-nil, human-readable error on the
// first violation found.
func validateCheckinSettings(raw json.RawMessage) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var shape checkinSettingsShape
	if err := dec.Decode(&shape); err != nil {
		return fmt.Errorf("invalid settings: %w", err)
	}
	if shape.PrintOnCheckin == nil {
		return errors.New("print_on_checkin is required")
	}
	if shape.VerdictAutoDismissSec == nil {
		return errors.New("verdict_auto_dismiss_sec is required")
	}
	if *shape.VerdictAutoDismissSec < 1 || *shape.VerdictAutoDismissSec > 30 {
		return errors.New("verdict_auto_dismiss_sec must be between 1 and 30")
	}
	if shape.ScanInput == nil {
		return errors.New("scan_input is required")
	}
	if !validCheckinScanInputs[*shape.ScanInput] {
		return errors.New("scan_input must be one of wedge, scanner, manual")
	}
	if shape.ManualSearchEnabled == nil {
		return errors.New("manual_search_enabled is required")
	}
	return nil
}

// GetCheckinSettings returns the event's check-in settings (verbatim
// JSON). Settings is null when the event has never had settings saved.
func (h *Handler) GetCheckinSettings(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ownership must be established before any store call (BadgeTemplate
	// precedent): GetCheckinSettings collapses "no such event" and "no
	// settings yet" into the same nil value, so calling it first would
	// mask a foreign/deleted event as an empty-settings 200 instead of 404.
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	settings, err := h.Store.GetCheckinSettings(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load check-in settings"})
	}

	return c.JSON(http.StatusOK, CheckinSettingsResponse{Settings: settings})
}

// PutCheckinSettings validates and saves the event's check-in settings.
// Storage is verbatim: the persisted bytes are the request's raw
// "settings" JSON, untouched — only a parsed COPY is validated via
// validateCheckinSettings.
func (h *Handler) PutCheckinSettings(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ownership first (see GetCheckinSettings's comment): a deleted/foreign
	// event must be caught here as a 404, not surfaced later as a
	// misleading 500 from the guarded UPDATE's silent no-op.
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req CheckinSettingsPutRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if len(req.Settings) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "settings is required"})
	}
	if err := validateCheckinSettings(req.Settings); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	if err := h.Store.UpdateCheckinSettings(c.Request().Context(), eventID, req.Settings); err != nil {
		// ErrEventNotFound is reachable only via the soft-delete race
		// (PR #77 bot-review round, Finding C): the requireEventOwnership
		// pre-check above passed, then a concurrent DELETE soft-deleted the
		// event before the guarded UPDATE ran — map it to the same 404
		// masking (and wording) as requireEventOwnership, not a fabricated
		// 200 with settings that were never actually persisted.
		if errors.Is(err, store.ErrEventNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Event not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save check-in settings"})
	}

	return c.JSON(http.StatusOK, CheckinSettingsResponse(req))
}
