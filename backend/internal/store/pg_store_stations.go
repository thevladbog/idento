package store

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CreateProvisioningToken persists a one-time station-provisioning token.
func (s *PGStore) CreateProvisioningToken(ctx context.Context, tok *models.StationProvisioningToken) error {
	tok.CreatedAt = time.Now()
	query := `INSERT INTO station_provisioning_tokens (token, event_id, staff_user_id, created_by, expires_at, created_at)
			  VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := s.db.Exec(ctx, query, tok.Token, tok.EventID, tok.StaffUserID, tok.CreatedBy, tok.ExpiresAt, tok.CreatedAt)
	return err
}

// ConsumeProvisioningToken atomically marks a token consumed and returns it, or
// (nil, nil) if it doesn't exist, is already consumed, or has expired — the
// UPDATE's WHERE clause makes this check-and-consume atomic under concurrent
// redemption attempts of the same token.
func (s *PGStore) ConsumeProvisioningToken(ctx context.Context, token string) (*models.StationProvisioningToken, error) {
	query := `
		UPDATE station_provisioning_tokens
		SET consumed_at = NOW()
		WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW()
		RETURNING token, event_id, staff_user_id, created_by, expires_at, consumed_at, created_at
	`
	row := s.db.QueryRow(ctx, query, token)
	var t models.StationProvisioningToken
	err := row.Scan(&t.Token, &t.EventID, &t.StaffUserID, &t.CreatedBy, &t.ExpiresAt, &t.ConsumedAt, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateStation assigns the next device_number for the event (serialized by
// locking the event row for the duration of the transaction) and inserts the
// station row.
func (s *PGStore) CreateStation(ctx context.Context, eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && rbErr != pgx.ErrTxClosed {
			log.Printf("Failed to rollback transaction: %v", rbErr)
		}
	}()

	if _, err := tx.Exec(ctx, `SELECT id FROM events WHERE id = $1 FOR UPDATE`, eventID); err != nil {
		return nil, err
	}

	var nextNumber int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(device_number), 0) + 1 FROM stations WHERE event_id = $1`,
		eventID,
	).Scan(&nextNumber); err != nil {
		return nil, err
	}

	deviceInfoJSON, err := json.Marshal(deviceInfo)
	if err != nil {
		return nil, err
	}

	station := &models.Station{
		ID:           uuid.New(),
		EventID:      eventID,
		DeviceNumber: nextNumber,
		StaffUserID:  staffUserID,
		DeviceInfo:   deviceInfo,
		CreatedAt:    time.Now(),
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO stations (id, event_id, device_number, staff_user_id, device_info, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		station.ID, station.EventID, station.DeviceNumber, station.StaffUserID, deviceInfoJSON, station.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return station, nil
}
