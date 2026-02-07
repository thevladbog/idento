package middleware

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"idento/backend/internal/store"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type contextKey string

const EventIDKey contextKey = "event_id"

// APIKeyAuth middleware for public endpoints
func APIKeyAuth(s store.Store) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			apiKey := c.Request().Header.Get("X-API-Key")
			if apiKey == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "Missing X-API-Key header",
				})
			}

			// Hash the provided key to compare with stored hash
			hasher := sha256.New()
			hasher.Write([]byte(apiKey))
			keyHash := hex.EncodeToString(hasher.Sum(nil))

			// Lookup key in database
			key, err := s.GetAPIKeyByHash(context.Background(), keyHash)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "Invalid API key",
				})
			}

			// Check if key is revoked
			if key.RevokedAt != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "API key has been revoked",
				})
			}

			// Check if key is expired
			if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "API key has expired",
				})
			}

			// Update last used timestamp (async, don't block request)
			go func() {
				if err := s.UpdateAPIKeyLastUsed(context.Background(), key.ID); err != nil {
					fmt.Printf("Failed to update API key last used: %v\n", err)
				}
			}()

			// Store event_id in context for later use
			c.Set(string(EventIDKey), key.EventID)

			return next(c)
		}
	}
}

// GetEventIDFromContext extracts event_id from context
func GetEventIDFromContext(c echo.Context) (uuid.UUID, error) {
	eventID := c.Get(string(EventIDKey))
	if eventID == nil {
		return uuid.Nil, echo.NewHTTPError(http.StatusInternalServerError, "Event ID not found in context")
	}

	eventUUID, ok := eventID.(uuid.UUID)
	if !ok {
		return uuid.Nil, echo.NewHTTPError(http.StatusInternalServerError, "Invalid event ID type in context")
	}
	return eventUUID, nil
}

// Generate a new API key (plain text) and its hash
func GenerateAPIKey() (plainKey string, keyHash string, err error) {
	// Generate random bytes for the key
	keyBytes := make([]byte, 32)
	_, err = rand.Read(keyBytes)
	if err != nil {
		return "", "", err
	}

	// Convert to hex string for plain key
	plainKey = hex.EncodeToString(keyBytes)

	// Hash the plain key
	hasher := sha256.New()
	hasher.Write([]byte(plainKey))
	keyHash = hex.EncodeToString(hasher.Sum(nil))

	return plainKey, keyHash, nil
}
