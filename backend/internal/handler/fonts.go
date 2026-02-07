package handler

import (
	"fmt"
	"idento/backend/internal/models"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// GetEventFonts returns list of fonts for a specific event
func (h *Handler) GetEventFonts(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid event ID",
		})
	}

	fonts, err := h.Store.GetFontsByEventID(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get fonts",
		})
	}

	if fonts == nil {
		fonts = []*models.FontListItem{}
	}

	return c.JSON(http.StatusOK, fonts)
}

// UploadEventFont handles font file upload for a specific event
func (h *Handler) UploadEventFont(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid event ID",
		})
	}

	// Safely extract user from context
	userToken := c.Get("user")
	if userToken == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized",
		})
	}

	token, ok := userToken.(*jwt.Token)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid token",
		})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid token claims",
		})
	}

	// Safely extract user_id from claims
	userIDValue, exists := claims["user_id"]
	if !exists {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Missing user_id in token",
		})
	}

	var userIDStr string
	switch v := userIDValue.(type) {
	case string:
		userIDStr = v
	case float64:
		userIDStr = fmt.Sprintf("%.0f", v)
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid user_id format",
		})
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid user ID",
		})
	}

	// Check license acceptance
	licenseAccepted := c.FormValue("license_accepted")
	if licenseAccepted != "true" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "You must accept the font license terms to upload",
		})
	}

	// Get form values
	name := c.FormValue("name")
	family := c.FormValue("family")
	weight := c.FormValue("weight")
	style := c.FormValue("style")

	if name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Font name is required",
		})
	}
	if family == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Font family is required",
		})
	}
	if weight == "" {
		weight = "normal"
	}
	if style == "" {
		style = "normal"
	}

	// Get file
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Font file is required",
		})
	}

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(file.Filename))
	validFormats := map[string]string{
		".woff2": "woff2",
		".woff":  "woff",
		".ttf":   "truetype",
		".otf":   "opentype",
	}
	format, ok := validFormats[ext]
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid font format. Supported: woff2, woff, ttf, otf",
		})
	}

	// Check file size (max 5MB)
	if file.Size > 5*1024*1024 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Font file too large. Maximum size is 5MB",
		})
	}

	// Read file content
	src, err := file.Open()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read font file",
		})
	}
	defer func() {
		if closeErr := src.Close(); closeErr != nil {
			log.Printf("Failed to close file: %v", closeErr)
		}
	}()

	data, err := io.ReadAll(src)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read font file",
		})
	}

	// Determine MIME type
	mimeTypes := map[string]string{
		".woff2": "font/woff2",
		".woff":  "font/woff",
		".ttf":   "font/ttf",
		".otf":   "font/otf",
	}

	now := time.Now()
	font := &models.Font{
		ID:                uuid.New(),
		EventID:           eventID,
		Name:              name,
		Family:            family,
		Weight:            weight,
		Style:             style,
		Format:            format,
		Data:              data,
		Size:              file.Size,
		MimeType:          mimeTypes[ext],
		UploadedBy:        userID,
		LicenseAcceptedAt: now,
		CreatedAt:         now,
	}

	if err := h.Store.CreateFont(c.Request().Context(), font); err != nil {
		// Check for unique constraint violation
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			return c.JSON(http.StatusConflict, map[string]string{
				"error": fmt.Sprintf("Font with family '%s', weight '%s', style '%s' already exists for this event", family, weight, style),
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save font",
		})
	}

	return c.JSON(http.StatusCreated, models.FontListItem{
		ID:        font.ID,
		Name:      font.Name,
		Family:    font.Family,
		Weight:    font.Weight,
		Style:     font.Style,
		Format:    font.Format,
		Size:      font.Size,
		CreatedAt: font.CreatedAt,
	})
}

// GetFontFile serves the font file for browser loading
func (h *Handler) GetFontFile(c echo.Context) error {
	fontID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid font ID",
		})
	}

	font, err := h.Store.GetFontByID(c.Request().Context(), fontID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Font not found",
		})
	}

	// Set cache headers (fonts rarely change)
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000")
	c.Response().Header().Set("Content-Type", font.MimeType)

	return c.Blob(http.StatusOK, font.MimeType, font.Data)
}

// GetEventFontCSS generates @font-face CSS for all event fonts
func (h *Handler) GetEventFontCSS(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid event ID",
		})
	}

	fonts, err := h.Store.GetFontsByEventID(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get fonts",
		})
	}

	// Generate CSS
	var css strings.Builder
	css.WriteString("/* Auto-generated font faces for event */\n\n")

	for _, font := range fonts {
		css.WriteString(fmt.Sprintf(`@font-face {
  font-family: '%s';
  font-weight: %s;
  font-style: %s;
  src: url('/api/fonts/%s/file') format('%s');
  font-display: swap;
}

`, font.Family, font.Weight, font.Style, font.ID.String(), font.Format))
	}

	c.Response().Header().Set("Content-Type", "text/css; charset=utf-8")
	c.Response().Header().Set("Cache-Control", "public, max-age=3600")
	return c.String(http.StatusOK, css.String())
}

// DeleteEventFont removes a font from an event
func (h *Handler) DeleteEventFont(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid event ID",
		})
	}

	fontID, err := uuid.Parse(c.Param("font_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid font ID",
		})
	}

	// Verify font belongs to event
	font, err := h.Store.GetFontByID(c.Request().Context(), fontID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Font not found",
		})
	}

	if font.EventID != eventID {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": "Font does not belong to this event",
		})
	}

	if err := h.Store.DeleteFont(c.Request().Context(), fontID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete font",
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"status": "deleted",
	})
}
