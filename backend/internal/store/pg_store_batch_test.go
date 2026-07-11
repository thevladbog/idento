package store

import (
	"context"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// attendeeSelectColumns mirrors the column list GetAttendeeByID/GetAttendeeByCode
// select, in scan order — kept here so both ApplyBatchCheckin tests can build
// rows without repeating the 19-column list inline.
var attendeeSelectColumns = []string{
	"id", "event_id", "first_name", "last_name", "email", "company", "position", "code",
	"checkin_status", "checked_in_at", "checked_in_by", "checked_in_device_number", "checked_in_point_name",
	"printed_count", "custom_fields", "blocked", "block_reason", "created_at", "updated_at",
}

// TestApplyBatchCheckin_CheckinPersistsDeviceAndPointName is the store half of
// M1c-1's "already checked in — where and by which device" feature: a
// kind=checkin batch item carrying device_number + point_name must land on
// the attendees row's checked_in_device_number/checked_in_point_name columns
// via the same UpdateAttendee write ApplyBatchCheckin already used for
// checked_in_at/checked_in_by, and a subsequent GetAttendeeByID must read
// them back.
func TestApplyBatchCheckin_CheckinPersistsDeviceAndPointName(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, staffUserID, attendeeID, clientUUID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 7, 11, 9, 30, 0, 0, time.UTC)
	deviceNumber := 7
	pointName := "Стойка А"
	now := time.Now()

	// batch_checkin_log dedup check: this client_uuid was not seen before.
	mock.ExpectQuery(`FROM batch_checkin_log WHERE client_uuid`).
		WithArgs(clientUUID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

	// GetAttendeeByID (inside ApplyBatchCheckin): attendee not yet checked in.
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			false, nil, nil, nil, nil,
			0, nil, false, nil, now, now,
		))

	// The write must now carry the device number + point name alongside the
	// pre-existing checkin_status/checked_in_at/checked_in_by columns.
	mock.ExpectExec(`UPDATE attendees SET`).
		WithArgs(
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), // first_name..position
			true, &at, &staffUserID, &deviceNumber, &pointName, // checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name
			pgxmock.AnyArg(), pgxmock.AnyArg(), // printed_count, blocked
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), // block_reason, custom_fields, deleted_at
			attendeeID,
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	mock.ExpectExec(`INSERT INTO batch_checkin_log`).
		WithArgs(clientUUID, eventID, attendeeID, "checkin", (*uuid.UUID)(nil), deviceNumber, at).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	item := &models.BatchCheckinItem{
		ClientUUID:   clientUUID,
		AttendeeID:   attendeeID,
		At:           at,
		DeviceNumber: deviceNumber,
		Kind:         "checkin",
		PointName:    &pointName,
	}
	applied, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if !applied {
		t.Fatal("expected applied=true for a first-time checkin")
	}

	// Fetch the attendee back and confirm the two new fields round-trip
	// through GetAttendeeByID's SELECT (not just the UPDATE args).
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			true, &at, &staffUserID, &deviceNumber, &pointName,
			0, nil, false, nil, now, now,
		))

	fetched, err := s.GetAttendeeByID(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("GetAttendeeByID: %v", err)
	}
	if fetched.CheckedInDeviceNumber == nil || *fetched.CheckedInDeviceNumber != deviceNumber {
		t.Fatalf("CheckedInDeviceNumber = %v, want %d", fetched.CheckedInDeviceNumber, deviceNumber)
	}
	if fetched.CheckedInPointName == nil || *fetched.CheckedInPointName != pointName {
		t.Fatalf("CheckedInPointName = %v, want %q", fetched.CheckedInPointName, pointName)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestApplyBatchCheckin_ZoneEntryDoesNotTouchCheckinDeviceOrPoint is the
// regression guard for the "checkin only" rule in ApplyBatchCheckin's
// extended write: a kind=zone_entry item must never set
// checked_in_device_number/checked_in_point_name on the attendees row — those
// columns are registration-specific, and zone entries are tracked separately
// via zone_checkins/zone_scan_log. The test deliberately scripts no
// attendees SELECT/UPDATE expectation for the zone_entry branch itself: if
// the implementation regressed to also touch the attendees row, the next
// scripted (zone_checkins) expectation would fail to match and the call
// would return an error.
func TestApplyBatchCheckin_ZoneEntryDoesNotTouchCheckinDeviceOrPoint(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, staffUserID, attendeeID, zoneID, clientUUID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 7, 11, 9, 30, 0, 0, time.UTC)
	deviceNumber := 3
	pointName := "Стойка А" // deliberately non-nil: even if a mobile client sent
	// a point_name alongside a zone_entry, it must still be ignored.

	mock.ExpectQuery(`FROM batch_checkin_log WHERE client_uuid`).
		WithArgs(clientUUID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

	// No prior zone check-in for this attendee/zone/day.
	mock.ExpectQuery(`FROM zone_checkins`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "attendee_id", "zone_id", "checked_in_at", "checked_in_by", "event_day", "metadata"}))

	mock.ExpectExec(`INSERT INTO zone_checkins`).
		WithArgs(pgxmock.AnyArg(), attendeeID, zoneID, pgxmock.AnyArg(), &staffUserID, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	mock.ExpectExec(`INSERT INTO batch_checkin_log`).
		WithArgs(clientUUID, eventID, attendeeID, "zone_entry", &zoneID, deviceNumber, at).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	item := &models.BatchCheckinItem{
		ClientUUID:   clientUUID,
		AttendeeID:   attendeeID,
		At:           at,
		DeviceNumber: deviceNumber,
		Kind:         "zone_entry",
		ZoneID:       &zoneID,
		PointName:    &pointName,
	}
	applied, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if !applied {
		t.Fatal("expected applied=true for a first-time zone entry")
	}

	// Confirm the attendee's checkin device/point fields are still unset —
	// the zone_entry branch must never have written to them.
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			false, nil, nil, nil, nil,
			0, nil, false, nil, time.Now(), time.Now(),
		))

	fetched, err := s.GetAttendeeByID(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("GetAttendeeByID: %v", err)
	}
	if fetched.CheckedInDeviceNumber != nil {
		t.Fatalf("CheckedInDeviceNumber = %v, want nil after a zone_entry", *fetched.CheckedInDeviceNumber)
	}
	if fetched.CheckedInPointName != nil {
		t.Fatalf("CheckedInPointName = %v, want nil after a zone_entry", *fetched.CheckedInPointName)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
