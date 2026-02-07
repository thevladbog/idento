package store

import (
	"context"
	"encoding/json"
	"fmt"
	"idento/backend/internal/models"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CreateEventZone creates a new event zone
func (s *PGStore) CreateEventZone(ctx context.Context, zone *models.EventZone) error {
	zone.ID = uuid.New()
	zone.CreatedAt = time.Now()
	zone.UpdatedAt = time.Now()

	settingsJSON, err := json.Marshal(zone.Settings)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO event_zones (
			id, event_id, name, zone_type, order_index,
			open_time, close_time, is_registration_zone,
			requires_registration, is_active, settings,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`

	_, err = s.db.Exec(ctx, query,
		zone.ID, zone.EventID, zone.Name, zone.ZoneType, zone.OrderIndex,
		zone.OpenTime, zone.CloseTime, zone.IsRegistrationZone,
		zone.RequiresRegistration, zone.IsActive, settingsJSON,
		zone.CreatedAt, zone.UpdatedAt,
	)

	return err
}

// GetEventZones retrieves all zones for an event
func (s *PGStore) GetEventZones(ctx context.Context, eventID uuid.UUID) ([]*models.EventZone, error) {
	query := `
		SELECT id, event_id, name, zone_type, order_index,
			open_time, close_time, is_registration_zone,
			requires_registration, is_active, settings,
			created_at, updated_at
		FROM event_zones
		WHERE event_id = $1
		ORDER BY order_index ASC
	`

	rows, err := s.db.Query(ctx, query, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	zones := make([]*models.EventZone, 0)
	for rows.Next() {
		zone, err := scanEventZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, zone)
	}

	return zones, rows.Err()
}

// GetEventZoneByID retrieves a single zone by ID
func (s *PGStore) GetEventZoneByID(ctx context.Context, id uuid.UUID) (*models.EventZone, error) {
	query := `
		SELECT id, event_id, name, zone_type, order_index,
			open_time, close_time, is_registration_zone,
			requires_registration, is_active, settings,
			created_at, updated_at
		FROM event_zones
		WHERE id = $1
	`

	row := s.db.QueryRow(ctx, query, id)
	return scanEventZone(row)
}

// UpdateEventZone updates an existing zone
func (s *PGStore) UpdateEventZone(ctx context.Context, zone *models.EventZone) error {
	zone.UpdatedAt = time.Now()

	settingsJSON, err := json.Marshal(zone.Settings)
	if err != nil {
		return err
	}

	query := `
		UPDATE event_zones SET
			name = $1, zone_type = $2, order_index = $3,
			open_time = $4, close_time = $5, is_registration_zone = $6,
			requires_registration = $7, is_active = $8, settings = $9,
			updated_at = $10
		WHERE id = $11
	`

	_, err = s.db.Exec(ctx, query,
		zone.Name, zone.ZoneType, zone.OrderIndex,
		zone.OpenTime, zone.CloseTime, zone.IsRegistrationZone,
		zone.RequiresRegistration, zone.IsActive, settingsJSON,
		zone.UpdatedAt, zone.ID,
	)

	return err
}

// DeleteEventZone deletes a zone
func (s *PGStore) DeleteEventZone(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM event_zones WHERE id = $1`
	_, err := s.db.Exec(ctx, query, id)
	return err
}

// GetEventZonesWithStats retrieves zones with statistics
func (s *PGStore) GetEventZonesWithStats(ctx context.Context, eventID uuid.UUID) ([]*models.EventZoneWithStats, error) {
	zones, err := s.GetEventZones(ctx, eventID)
	if err != nil {
		return nil, err
	}

	result := make([]*models.EventZoneWithStats, 0)
	today := time.Now().Truncate(24 * time.Hour)

	for _, zone := range zones {
		stats := &models.EventZoneWithStats{Zone: zone}

		// Total checkins
		var totalCheckins int
		err := s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM zone_checkins WHERE zone_id = $1`,
			zone.ID,
		).Scan(&totalCheckins)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		stats.TotalCheckins = totalCheckins

		// Today's checkins
		var todayCheckins int
		err = s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM zone_checkins WHERE zone_id = $1 AND event_day = $2`,
			zone.ID, today,
		).Scan(&todayCheckins)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		stats.TodayCheckins = todayCheckins

		// Assigned staff
		var assignedStaff int
		err = s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM staff_zone_assignments WHERE zone_id = $1`,
			zone.ID,
		).Scan(&assignedStaff)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		stats.AssignedStaff = assignedStaff

		// Access rules count
		var accessRulesCount int
		err = s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM zone_access_rules WHERE zone_id = $1`,
			zone.ID,
		).Scan(&accessRulesCount)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		stats.AccessRulesCount = accessRulesCount

		result = append(result, stats)
	}

	return result, nil
}

// Zone Access Rules

// CreateZoneAccessRule creates a new access rule
func (s *PGStore) CreateZoneAccessRule(ctx context.Context, rule *models.ZoneAccessRule) error {
	rule.ID = uuid.New()
	rule.CreatedAt = time.Now()

	query := `
		INSERT INTO zone_access_rules (id, zone_id, category, allowed, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (zone_id, category) DO UPDATE SET allowed = EXCLUDED.allowed
	`

	_, err := s.db.Exec(ctx, query,
		rule.ID, rule.ZoneID, rule.Category, rule.Allowed, rule.CreatedAt,
	)

	return err
}

// GetZoneAccessRules retrieves all access rules for a zone
func (s *PGStore) GetZoneAccessRules(ctx context.Context, zoneID uuid.UUID) ([]*models.ZoneAccessRule, error) {
	query := `
		SELECT id, zone_id, category, allowed, created_at
		FROM zone_access_rules
		WHERE zone_id = $1
		ORDER BY category ASC
	`

	rows, err := s.db.Query(ctx, query, zoneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.ZoneAccessRule
	for rows.Next() {
		var rule models.ZoneAccessRule
		err := rows.Scan(
			&rule.ID, &rule.ZoneID, &rule.Category,
			&rule.Allowed, &rule.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		rules = append(rules, &rule)
	}

	return rules, rows.Err()
}

// DeleteZoneAccessRule deletes an access rule
func (s *PGStore) DeleteZoneAccessRule(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM zone_access_rules WHERE id = $1`
	_, err := s.db.Exec(ctx, query, id)
	return err
}

// BulkUpdateZoneAccessRules updates multiple access rules at once
func (s *PGStore) BulkUpdateZoneAccessRules(ctx context.Context, zoneID uuid.UUID, rules []*models.ZoneAccessRule) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && rbErr != pgx.ErrTxClosed {
			log.Printf("Failed to rollback transaction: %v", rbErr)
		}
	}()

	// Delete existing rules
	_, err = tx.Exec(ctx, `DELETE FROM zone_access_rules WHERE zone_id = $1`, zoneID)
	if err != nil {
		return err
	}

	// Insert new rules
	for _, rule := range rules {
		rule.ID = uuid.New()
		rule.ZoneID = zoneID
		rule.CreatedAt = time.Now()

		_, err = tx.Exec(ctx,
			`INSERT INTO zone_access_rules (id, zone_id, category, allowed, created_at) VALUES ($1, $2, $3, $4, $5)`,
			rule.ID, rule.ZoneID, rule.Category, rule.Allowed, rule.CreatedAt,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// Attendee Zone Access

// CreateAttendeeZoneAccess creates an individual access override
func (s *PGStore) CreateAttendeeZoneAccess(ctx context.Context, access *models.AttendeeZoneAccess) error {
	access.ID = uuid.New()
	access.CreatedAt = time.Now()
	access.UpdatedAt = time.Now()

	query := `
		INSERT INTO attendee_zone_access (id, attendee_id, zone_id, allowed, notes, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (attendee_id, zone_id) DO UPDATE SET
			allowed = EXCLUDED.allowed,
			notes = EXCLUDED.notes,
			updated_at = EXCLUDED.updated_at
	`

	_, err := s.db.Exec(ctx, query,
		access.ID, access.AttendeeID, access.ZoneID, access.Allowed,
		access.Notes, access.CreatedAt, access.UpdatedAt,
	)

	return err
}

// GetAttendeeZoneAccess retrieves a specific access override
func (s *PGStore) GetAttendeeZoneAccess(ctx context.Context, attendeeID, zoneID uuid.UUID) (*models.AttendeeZoneAccess, error) {
	query := `
		SELECT id, attendee_id, zone_id, allowed, notes, created_at, updated_at
		FROM attendee_zone_access
		WHERE attendee_id = $1 AND zone_id = $2
	`

	var access models.AttendeeZoneAccess
	err := s.db.QueryRow(ctx, query, attendeeID, zoneID).Scan(
		&access.ID, &access.AttendeeID, &access.ZoneID,
		&access.Allowed, &access.Notes, &access.CreatedAt, &access.UpdatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &access, nil
}

// GetAttendeeZoneAccessList retrieves all access overrides for an attendee
func (s *PGStore) GetAttendeeZoneAccessList(ctx context.Context, attendeeID uuid.UUID) ([]*models.AttendeeZoneAccess, error) {
	query := `
		SELECT id, attendee_id, zone_id, allowed, notes, created_at, updated_at
		FROM attendee_zone_access
		WHERE attendee_id = $1
	`

	rows, err := s.db.Query(ctx, query, attendeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accesses []*models.AttendeeZoneAccess
	for rows.Next() {
		var access models.AttendeeZoneAccess
		err := rows.Scan(
			&access.ID, &access.AttendeeID, &access.ZoneID,
			&access.Allowed, &access.Notes, &access.CreatedAt, &access.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		accesses = append(accesses, &access)
	}

	return accesses, rows.Err()
}

// UpdateAttendeeZoneAccess updates an access override
func (s *PGStore) UpdateAttendeeZoneAccess(ctx context.Context, access *models.AttendeeZoneAccess) error {
	access.UpdatedAt = time.Now()

	query := `
		UPDATE attendee_zone_access SET
			allowed = $1, notes = $2, updated_at = $3
		WHERE id = $4
	`

	_, err := s.db.Exec(ctx, query,
		access.Allowed, access.Notes, access.UpdatedAt, access.ID,
	)

	return err
}

// DeleteAttendeeZoneAccess deletes an access override
func (s *PGStore) DeleteAttendeeZoneAccess(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM attendee_zone_access WHERE id = $1`
	_, err := s.db.Exec(ctx, query, id)
	return err
}

// Zone Check-ins

// CreateZoneCheckin creates a new zone check-in record
func (s *PGStore) CreateZoneCheckin(ctx context.Context, checkin *models.ZoneCheckin) error {
	checkin.ID = uuid.New()
	checkin.CheckedInAt = time.Now()

	metadataJSON, err := json.Marshal(checkin.Metadata)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO zone_checkins (
			id, attendee_id, zone_id, checked_in_at,
			checked_in_by, event_day, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`

	_, err = s.db.Exec(ctx, query,
		checkin.ID, checkin.AttendeeID, checkin.ZoneID,
		checkin.CheckedInAt, checkin.CheckedInBy, checkin.EventDay, metadataJSON,
	)

	return err
}

// GetZoneCheckins retrieves all check-ins for a zone on a specific date
func (s *PGStore) GetZoneCheckins(ctx context.Context, zoneID uuid.UUID, date time.Time) ([]*models.ZoneCheckin, error) {
	dateOnly := date.Truncate(24 * time.Hour)

	query := `
		SELECT id, attendee_id, zone_id, checked_in_at,
			checked_in_by, event_day, metadata
		FROM zone_checkins
		WHERE zone_id = $1 AND event_day = $2
		ORDER BY checked_in_at DESC
	`

	rows, err := s.db.Query(ctx, query, zoneID, dateOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checkins []*models.ZoneCheckin
	for rows.Next() {
		checkin, err := scanZoneCheckin(rows)
		if err != nil {
			return nil, err
		}
		checkins = append(checkins, checkin)
	}

	return checkins, rows.Err()
}

// GetAttendeeZoneCheckins retrieves all zone check-ins for an attendee
func (s *PGStore) GetAttendeeZoneCheckins(ctx context.Context, attendeeID uuid.UUID) ([]*models.ZoneCheckin, error) {
	query := `
		SELECT id, attendee_id, zone_id, checked_in_at,
			checked_in_by, event_day, metadata
		FROM zone_checkins
		WHERE attendee_id = $1
		ORDER BY checked_in_at DESC
	`

	rows, err := s.db.Query(ctx, query, attendeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checkins []*models.ZoneCheckin
	for rows.Next() {
		checkin, err := scanZoneCheckin(rows)
		if err != nil {
			return nil, err
		}
		checkins = append(checkins, checkin)
	}

	return checkins, rows.Err()
}

// CheckAttendeeZoneCheckin checks if an attendee has checked into a zone on a specific date
func (s *PGStore) CheckAttendeeZoneCheckin(ctx context.Context, attendeeID, zoneID uuid.UUID, date time.Time) (*models.ZoneCheckin, error) {
	dateOnly := date.Truncate(24 * time.Hour)

	query := `
		SELECT id, attendee_id, zone_id, checked_in_at,
			checked_in_by, event_day, metadata
		FROM zone_checkins
		WHERE attendee_id = $1 AND zone_id = $2 AND event_day = $3
	`

	row := s.db.QueryRow(ctx, query, attendeeID, zoneID, dateOnly)
	checkin, err := scanZoneCheckin(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return checkin, err
}

// Staff Zone Assignments

// AssignStaffToZone assigns a staff member to a zone
func (s *PGStore) AssignStaffToZone(ctx context.Context, assignment *models.StaffZoneAssignment) error {
	assignment.ID = uuid.New()
	assignment.AssignedAt = time.Now()

	query := `
		INSERT INTO staff_zone_assignments (id, user_id, zone_id, assigned_at, assigned_by)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, zone_id) DO NOTHING
	`

	_, err := s.db.Exec(ctx, query,
		assignment.ID, assignment.UserID, assignment.ZoneID,
		assignment.AssignedAt, assignment.AssignedBy,
	)

	return err
}

// GetStaffZoneAssignments retrieves all zone assignments for a staff member
func (s *PGStore) GetStaffZoneAssignments(ctx context.Context, userID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
	query := `
		SELECT id, user_id, zone_id, assigned_at, assigned_by
		FROM staff_zone_assignments
		WHERE user_id = $1
	`

	rows, err := s.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assignments []*models.StaffZoneAssignment
	for rows.Next() {
		var assignment models.StaffZoneAssignment
		err := rows.Scan(
			&assignment.ID, &assignment.UserID, &assignment.ZoneID,
			&assignment.AssignedAt, &assignment.AssignedBy,
		)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, &assignment)
	}

	return assignments, rows.Err()
}

// GetZoneStaffAssignments retrieves all staff assigned to a zone
func (s *PGStore) GetZoneStaffAssignments(ctx context.Context, zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
	query := `
		SELECT id, user_id, zone_id, assigned_at, assigned_by
		FROM staff_zone_assignments
		WHERE zone_id = $1
	`

	rows, err := s.db.Query(ctx, query, zoneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assignments []*models.StaffZoneAssignment
	for rows.Next() {
		var assignment models.StaffZoneAssignment
		err := rows.Scan(
			&assignment.ID, &assignment.UserID, &assignment.ZoneID,
			&assignment.AssignedAt, &assignment.AssignedBy,
		)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, &assignment)
	}

	return assignments, rows.Err()
}

// RemoveStaffFromZone removes a staff member from a zone
func (s *PGStore) RemoveStaffFromZone(ctx context.Context, userID, zoneID uuid.UUID) error {
	query := `DELETE FROM staff_zone_assignments WHERE user_id = $1 AND zone_id = $2`
	_, err := s.db.Exec(ctx, query, userID, zoneID)
	return err
}

// CheckZoneAccess validates if an attendee has access to a zone
func (s *PGStore) CheckZoneAccess(ctx context.Context, attendeeID, zoneID uuid.UUID) (bool, string, error) {
	// 1. Get attendee info
	attendee, err := s.GetAttendeeByID(ctx, attendeeID)
	if err != nil {
		return false, "Attendee not found", err
	}

	// 2. Check if blocked
	if attendee.Blocked {
		return false, "Attendee is blocked", nil
	}

	// 3. Check individual override first (highest priority)
	override, err := s.GetAttendeeZoneAccess(ctx, attendeeID, zoneID)
	if err == nil && override != nil {
		if !override.Allowed {
			return false, "Access denied (individual override)", nil
		}
		return true, "Access granted (individual override)", nil
	}

	// 4. Check category-based rules
	category, ok := attendee.CustomFields["category"].(string)
	if ok && category != "" {
		rules, err := s.GetZoneAccessRules(ctx, zoneID)
		if err == nil && len(rules) > 0 {
			// If rules exist, check if category is explicitly allowed
			for _, rule := range rules {
				if rule.Category == category {
					if !rule.Allowed {
						return false, fmt.Sprintf("Access denied for category: %s", category), nil
					}
					return true, "Access granted by category", nil
				}
			}
			// Category not in rules = denied if rules exist
			return false, "Category not authorized for this zone", nil
		}
	}

	// 5. Default: allow if no rules defined
	return true, "Access granted (default)", nil
}

// Helper functions

func scanEventZone(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.EventZone, error) {
	var zone models.EventZone
	var settingsJSON []byte

	err := scanner.Scan(
		&zone.ID, &zone.EventID, &zone.Name, &zone.ZoneType, &zone.OrderIndex,
		&zone.OpenTime, &zone.CloseTime, &zone.IsRegistrationZone,
		&zone.RequiresRegistration, &zone.IsActive, &settingsJSON,
		&zone.CreatedAt, &zone.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if len(settingsJSON) > 0 {
		if err := json.Unmarshal(settingsJSON, &zone.Settings); err != nil {
			return nil, err
		}
	}

	return &zone, nil
}

func scanZoneCheckin(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.ZoneCheckin, error) {
	var checkin models.ZoneCheckin
	var metadataJSON []byte

	err := scanner.Scan(
		&checkin.ID, &checkin.AttendeeID, &checkin.ZoneID,
		&checkin.CheckedInAt, &checkin.CheckedInBy, &checkin.EventDay, &metadataJSON,
	)
	if err != nil {
		return nil, err
	}

	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &checkin.Metadata); err != nil {
			return nil, err
		}
	}

	return &checkin, nil
}
