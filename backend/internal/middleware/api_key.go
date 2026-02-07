package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
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

			// Lookup by loading active keys and verifying with bcrypt only (no SHA256 on sensitive data).
			activeKeys, err := s.GetActiveAPIKeys(context.Background())
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to verify API key",
				})
			}
			var key *models.APIKey
			for _, k := range activeKeys {
				if k.KeyHashBcrypt != nil && bcrypt.CompareHashAndPassword([]byte(*k.KeyHashBcrypt), []byte(apiKey)) == nil {
					key = k
					break
				}
			}
			if key == nil {
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
					log.Printf("Failed to update API key last used: %v", err)
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

// GenerateAPIKey returns a new API key (plain text), a unique placeholder for key_hash, and bcrypt hash for verification.
// No SHA256 is used on the key; verification is bcrypt-only via GetActiveAPIKeys.
func GenerateAPIKey() (plainKey string, keyHashPlaceholder string, keyHashBcrypt string, err error) {
	keyBytes := make([]byte, 32)
	_, err = rand.Read(keyBytes)
	if err != nil {
		return "", "", "", err
	}
	plainKey = hex.EncodeToString(keyBytes)
	keyHashPlaceholder = "bcrypt:" + uuid.New().String()
	keyHashBcryptBytes, err := bcrypt.GenerateFromPassword([]byte(plainKey), bcrypt.DefaultCost)
	if err != nil {
		return "", "", "", err
	}
	return plainKey, keyHashPlaceholder, string(keyHashBcryptBytes), nil
}
