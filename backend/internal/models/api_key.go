package models

import (
	"time"

	"github.com/google/uuid"
)

type APIKey struct {
	ID         uuid.UUID  `json:"id"`
	EventID    uuid.UUID  `json:"event_id"`
	Name       string     `json:"name"`
	KeyHash    string     `json:"-"`           // Never expose the hash
	KeyPreview string     `json:"key_preview"` // Only first 8 chars for display
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type CreateAPIKeyRequest struct {
	Name      string     `json:"name" binding:"required"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

type CreateAPIKeyResponse struct {
	APIKey   APIKey `json:"api_key"`
	PlainKey string `json:"plain_key"` // Only returned once on creation
}

type ExternalImportRequest struct {
	Data []map[string]interface{} `json:"data" binding:"required"`
}
