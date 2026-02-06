package store

import (
	"context"
	"idento/backend/internal/models"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *PGStore) GetEventsChangedSince(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]*models.Event, error) {
	query := `SELECT id, tenant_id, name, start_date, end_date, location, created_at, updated_at 
			  FROM events WHERE tenant_id = $1 AND updated_at > $2`

	// If since is zero, we want all non-deleted
	if since.IsZero() {
		query = `SELECT id, tenant_id, name, start_date, end_date, location, created_at, updated_at 
				 FROM events WHERE tenant_id = $1 AND deleted_at IS NULL`
	}

	var rows pgx.Rows
	var err error

	if since.IsZero() {
		rows, err = s.db.Query(ctx, query, tenantID)
	} else {
		rows, err = s.db.Query(ctx, query, tenantID, since)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.ID, &e.TenantID, &e.Name, &e.StartDate, &e.EndDate, &e.Location, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		events = append(events, &e)
	}
	return events, nil
}

func (s *PGStore) GetAttendeesChangedSince(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]*models.Attendee, error) {
	// Complex join because attendees table doesn't have tenant_id directly (it's on event)
	query := `SELECT a.id, a.event_id, a.first_name, a.last_name, a.email, a.company, a.position, a.code, a.checkin_status, a.checked_in_at, a.printed_count, a.created_at, a.updated_at 
			  FROM attendees a
			  JOIN events e ON a.event_id = e.id
			  WHERE e.tenant_id = $1 AND a.updated_at > $2`

	if since.IsZero() {
		query = `SELECT a.id, a.event_id, a.first_name, a.last_name, a.email, a.company, a.position, a.code, a.checkin_status, a.checked_in_at, a.printed_count, a.created_at, a.updated_at 
				 FROM attendees a
				 JOIN events e ON a.event_id = e.id
				 WHERE e.tenant_id = $1 AND a.deleted_at IS NULL`
	}

	var rows pgx.Rows
	var err error

	if since.IsZero() {
		rows, err = s.db.Query(ctx, query, tenantID)
	} else {
		rows, err = s.db.Query(ctx, query, tenantID, since)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var attendees []*models.Attendee
	for rows.Next() {
		var a models.Attendee
		if err := rows.Scan(&a.ID, &a.EventID, &a.FirstName, &a.LastName, &a.Email, &a.Company, &a.Position, &a.Code, &a.CheckinStatus, &a.CheckedInAt, &a.PrintedCount, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		attendees = append(attendees, &a)
	}
	return attendees, nil
}
