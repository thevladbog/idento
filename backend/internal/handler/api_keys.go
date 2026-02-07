package handler

import (
	"context"
	"fmt"
	"idento/backend/internal/middleware"
	"idento/backend/internal/models"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CreateAPIKey создает новый API-ключ для мероприятия
func (h *Handler) CreateAPIKey(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	var req models.CreateAPIKeyRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Validate expiration date if provided
	if req.ExpiresAt != nil && req.ExpiresAt.Before(time.Now()) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Expiration date must be in the future"})
	}

	// Generate API key
	plainKey, keyHash, err := middleware.GenerateAPIKey()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate API key"})
	}
	keyPreview := plainKey[:8] + "..." // Store only first 8 characters for display

	apiKey := &models.APIKey{
		ID:         uuid.New(),
		EventID:    eventID,
		Name:       req.Name,
		KeyHash:    keyHash,
		KeyPreview: keyPreview,
		ExpiresAt:  req.ExpiresAt,
		CreatedAt:  time.Now(),
	}

	if err := h.Store.CreateAPIKey(context.Background(), apiKey); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create API key"})
	}

	// Return the API key with plain text (only shown once!)
	response := models.CreateAPIKeyResponse{
		APIKey:   *apiKey,
		PlainKey: plainKey,
	}

	return c.JSON(http.StatusCreated, response)
}

// GetAPIKeys возвращает список API-ключей для мероприятия
func (h *Handler) GetAPIKeys(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	keys, err := h.Store.GetAPIKeysByEventID(context.Background(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch API keys"})
	}

	return c.JSON(http.StatusOK, keys)
}

// RevokeAPIKey отзывает API-ключ
func (h *Handler) RevokeAPIKey(c echo.Context) error {
	keyID, err := uuid.Parse(c.Param("key_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid key ID"})
	}

	if err := h.Store.RevokeAPIKey(context.Background(), keyID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to revoke API key"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "API key revoked successfully"})
}

// ExternalImport обрабатывает запросы от внешних систем для импорта участников
func (h *Handler) ExternalImport(c echo.Context) error {
	// Get event_id from context (set by APIKeyAuth middleware)
	eventID, err := middleware.GetEventIDFromContext(c)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get event context"})
	}

	var req models.ExternalImportRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request format"})
	}

	if len(req.Data) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "No data provided"})
	}

	// Get event to extract field schema
	event, err := h.Store.GetEventByID(context.Background(), eventID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Event not found"})
	}

	// Track import results
	var created, failed int
	var errors []string

	for idx, data := range req.Data {
		// Extract standard fields with type assertions
		firstName, _ := data["first_name"].(string)
		lastName, _ := data["last_name"].(string)
		email, _ := data["email"].(string)
		company, _ := data["company"].(string)
		position, _ := data["position"].(string)
		code, _ := data["code"].(string)

		// Validate required fields
		if firstName == "" || lastName == "" || email == "" {
			failed++
			errors = append(errors, fmt.Sprintf("Row %d: missing required fields (first_name, last_name, email)", idx+1))
			continue
		}

		// Generate code if not provided
		if code == "" {
			code = generateUniqueCode()
		}

		// Build custom_fields from remaining data
		customFields := make(map[string]interface{})
		for key, value := range data {
			if key != "first_name" && key != "last_name" && key != "email" &&
				key != "company" && key != "position" && key != "code" {
				customFields[key] = value
			}
		}

		// Update field schema if new fields are detected
		for key := range customFields {
			found := false
			for _, field := range event.FieldSchema {
				if field == key {
					found = true
					break
				}
			}
			if !found {
				event.FieldSchema = append(event.FieldSchema, key)
			}
		}

		attendee := &models.Attendee{
			ID:           uuid.New(),
			EventID:      eventID,
			FirstName:    firstName,
			LastName:     lastName,
			Email:        email,
			Company:      company,
			Position:     position,
			Code:         code,
			CustomFields: customFields,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		}

		// Try to create attendee
		if err := h.Store.CreateAttendee(context.Background(), attendee); err != nil {
			failed++
			errors = append(errors, fmt.Sprintf("Row %d: %s", idx+1, err.Error()))
		} else {
			created++
		}
	}

	// Update event field schema if new fields were added
	if err := h.Store.UpdateEvent(context.Background(), event); err != nil {
		// Log error but don't fail the import
		log.Printf("Warning: Failed to update event field schema: %v", err)
	}

	response := map[string]interface{}{
		"message": "Import completed",
		"results": map[string]interface{}{
			"created": created,
			"failed":  failed,
			"total":   len(req.Data),
		},
	}

	if len(errors) > 0 {
		response["errors"] = errors
	}

	return c.JSON(http.StatusOK, response)
}
