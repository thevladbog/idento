package store

import (
	"context"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// CreateCheckinOverride records a staff override ("Всё равно пропустить") for
// audit purposes, with the staff member and (optional) zone that triggered it.
func (s *PGStore) CreateCheckinOverride(ctx context.Context, o *models.CheckinOverride) error {
	o.ID = uuid.New()
	o.CreatedAt = time.Now()
	query := `INSERT INTO checkin_overrides (id, attendee_id, zone_id, context, staff_user_id, created_at)
			  VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := s.db.Exec(ctx, query, o.ID, o.AttendeeID, o.ZoneID, o.Context, o.StaffUserID, o.CreatedAt)
	return err
}
