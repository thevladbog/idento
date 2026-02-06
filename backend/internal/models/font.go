package models

import (
	"time"

	"github.com/google/uuid"
)

// Font represents a custom font uploaded for a specific event
type Font struct {
	ID                uuid.UUID `json:"id"`
	EventID           uuid.UUID `json:"event_id"`
	Name              string    `json:"name"`                // Display name (e.g., "Roboto Bold")
	Family            string    `json:"family"`              // CSS font-family name (e.g., "Roboto")
	Weight            string    `json:"weight"`              // Font weight: normal, bold, 100-900
	Style             string    `json:"style"`               // Font style: normal, italic
	Format            string    `json:"format"`              // woff2, woff, ttf, otf
	Data              []byte    `json:"-"`                   // Font file binary data (not exposed in JSON)
	Size              int64     `json:"size"`                // File size in bytes
	MimeType          string    `json:"mime_type"`           // MIME type
	UploadedBy        uuid.UUID `json:"uploaded_by"`         // User who uploaded
	LicenseAcceptedAt time.Time `json:"license_accepted_at"` // When user accepted license terms
	CreatedAt         time.Time `json:"created_at"`
}

// FontListItem is a lightweight version for listing fonts (without binary data)
type FontListItem struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Family    string    `json:"family"`
	Weight    string    `json:"weight"`
	Style     string    `json:"style"`
	Format    string    `json:"format"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

// FontUploadRequest for uploading a new font
type FontUploadRequest struct {
	Name            string `json:"name" form:"name"`
	Family          string `json:"family" form:"family"`
	Weight          string `json:"weight" form:"weight"`
	Style           string `json:"style" form:"style"`
	LicenseAccepted bool   `json:"license_accepted" form:"license_accepted"`
}
