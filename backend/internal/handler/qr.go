package handler

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	qrcode "github.com/skip2/go-qrcode"
)

// GetAttendeeQR generates a QR code image for the attendee
func (h *Handler) GetAttendeeQR(c echo.Context) error {
	attendeeIDStr := c.Param("id")

	// Parse UUID
	attendeeID, err := uuid.Parse(attendeeIDStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid attendee ID")
	}

	// Get attendee from database to retrieve the code
	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendeeID)
	if err != nil || attendee == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Attendee not found")
	}

	// Generate QR code (256x256 pixels, medium recovery level)
	qr, err := qrcode.Encode(attendee.Code, qrcode.Medium, 256)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate QR code")
	}

	// Set content type as PNG image
	c.Response().Header().Set("Content-Type", "image/png")
	c.Response().Header().Set("Cache-Control", "public, max-age=86400") // Cache for 24 hours

	return c.Blob(http.StatusOK, "image/png", qr)
}
