package middleware

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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

			// Lookup key: SHA256 used only for indexed lookup; verification uses bcrypt when key_hash_bcrypt is set.
			lookupHash := sha256Hex(apiKey)
			key, err := s.GetAPIKeyByHash(context.Background(), lookupHash)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "Invalid API key",
				})
			}

			// Verify with bcrypt when stored (new keys); legacy keys matched by lookup hash.
			if key.KeyHashBcrypt != nil {
				if err := bcrypt.CompareHashAndPassword([]byte(*key.KeyHashBcrypt), []byte(apiKey)); err != nil {
					return c.JSON(http.StatusUnauthorized, map[string]string{
						"error": "Invalid API key",
					})
				}
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

// sha256Hex returns SHA256(plain) as hex; used only for indexed lookup, not for verification.
func sha256Hex(plain string) string {
	hasher := sha256.New()
	hasher.Write([]byte(plain))
	return hex.EncodeToString(hasher.Sum(nil))
}

// GenerateAPIKey returns a new API key (plain text), its lookup hash (SHA256), and bcrypt hash for verification.
func GenerateAPIKey() (plainKey string, keyHash string, keyHashBcrypt string, err error) {
	keyBytes := make([]byte, 32)
	_, err = rand.Read(keyBytes)
	if err != nil {
		return "", "", "", err
	}
	plainKey = hex.EncodeToString(keyBytes)
	keyHash = sha256Hex(plainKey)
	keyHashBcryptBytes, err := bcrypt.GenerateFromPassword([]byte(plainKey), bcrypt.DefaultCost)
	if err != nil {
		return "", "", "", err
	}
	return plainKey, keyHash, string(keyHashBcryptBytes), nil
}
