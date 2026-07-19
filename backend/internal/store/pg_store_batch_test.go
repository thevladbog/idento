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

	// GetAttendeeByID (inside ApplyBatchCheckin): existence check only, not
	// used to decide the write — the row's checkin_status here is irrelevant
	// to the outcome, which is decided solely by the guarded UPDATE below.
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			false, nil, nil, nil, nil,
			0, nil, false, nil, now, now,
		))

	// The kind=checkin branch now runs inside ONE short transaction
	// (2026-07-19 event-wide actions-feed design): the guarded UPDATE and —
	// when it wins — the 'checkin' feed row commit atomically, mirroring
	// CheckInAttendee. The batch_checkin_log insert stays OUTSIDE the tx.
	mock.ExpectBegin()
	// The single atomic guarded UPDATE: it must carry the device number +
	// point name alongside checked_in_at/checked_in_by, and affects exactly
	// one row because checkin_status is still false for this attendee.
	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(at, &staffUserID, &deviceNumber, &pointName, attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	// The event-wide actions-feed row: station-less (NULL station), stamped
	// with created_at = item.At — the exact value the UPDATE above wrote
	// into checked_in_at, so the monitor's current-period predicate holds
	// by equality.
	mock.ExpectExec(`INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id, created_at\)`).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "checkin", &staffUserID, &at).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

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
	outcome, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if outcome != BatchCheckinCreated {
		t.Fatalf("expected BatchCheckinCreated for a first-time checkin, got %v", outcome)
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
	outcome, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if outcome != BatchCheckinCreated {
		t.Fatalf("expected BatchCheckinCreated for a first-time zone entry, got %v", outcome)
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

// TestApplyBatchCheckin_AlreadyCheckedInByAnotherDeviceDoesNotRewrite is the
// regression guard for the "already checked in" gap: a kind=checkin item
// carrying a brand-new client_uuid (never logged in batch_checkin_log — this
// is NOT a client_uuid replay) for an attendee whose checkin_status is
// already true must:
//  1. return BatchCheckinAlreadyCheckedIn, not BatchCheckinCreated, and
//  2. have its guarded `UPDATE ... WHERE checkin_status = false` affect zero
//     rows — the original check-in's
//     checked_in_at/checked_in_by/checked_in_device_number/checked_in_point_name
//     must survive untouched. The implementation always issues this UPDATE
//     (the decision is made by its row count, not by a prior Go-level read),
//     so the mock scripts it explicitly with a 0-row result rather than
//     omitting it — an implementation that regressed to writing
//     unconditionally (ignoring the WHERE guard / affected-row count) would
//     still match this exec expectation but the "0 rows affected" branch
//     leads to a wrong outcome assertion below.
func TestApplyBatchCheckin_AlreadyCheckedInByAnotherDeviceDoesNotRewrite(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, staffUserID, attendeeID := uuid.New(), uuid.New(), uuid.New()
	originalStaffUserID := uuid.New()
	newClientUUID := uuid.New() // a different client_uuid than the one that made the original check-in

	originalAt := time.Date(2026, 7, 11, 8, 0, 0, 0, time.UTC)
	originalDevice := 1
	originalPoint := "Стойка А"
	now := time.Now()

	// A second device attempts the same attendee's check-in later.
	newAt := time.Date(2026, 7, 11, 9, 45, 0, 0, time.UTC)
	newDevice := 2
	newPoint := "Стойка Б"

	// batch_checkin_log dedup check: this client_uuid was never seen before —
	// this is genuinely a new request, not a replay.
	mock.ExpectQuery(`FROM batch_checkin_log WHERE client_uuid`).
		WithArgs(newClientUUID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

	// GetAttendeeByID: existence check only. The attendee was already checked
	// in (by a different device/staff user) prior to this request, but that
	// fact is surfaced by the guarded UPDATE's row count below, not by this
	// read.
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			true, &originalAt, &originalStaffUserID, &originalDevice, &originalPoint,
			0, nil, false, nil, now, now,
		))

	// The guarded UPDATE is still issued with the new device's values (that's
	// the whole point of making Postgres the arbiter), but affects zero rows
	// because checkin_status is already true — WHERE checkin_status = false
	// no longer matches this row.
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(newAt, &staffUserID, &newDevice, &newPoint, attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	// No checkin_actions insert is scripted: a 0-row guarded UPDATE means
	// no state change happened here — an implementation that inserted a
	// feed row anyway would fail on the unexpected exec before Commit.
	mock.ExpectCommit()

	mock.ExpectExec(`INSERT INTO batch_checkin_log`).
		WithArgs(newClientUUID, eventID, attendeeID, "checkin", (*uuid.UUID)(nil), newDevice, newAt).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	item := &models.BatchCheckinItem{
		ClientUUID:   newClientUUID,
		AttendeeID:   attendeeID,
		At:           newAt,
		DeviceNumber: newDevice,
		Kind:         "checkin",
		PointName:    &newPoint,
	}
	outcome, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if outcome != BatchCheckinAlreadyCheckedIn {
		t.Fatalf("expected BatchCheckinAlreadyCheckedIn, got %v", outcome)
	}

	// Fetch the attendee back and confirm the ORIGINAL check-in's data
	// survived untouched — not overwritten by the second device's attempt.
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			true, &originalAt, &originalStaffUserID, &originalDevice, &originalPoint,
			0, nil, false, nil, now, now,
		))

	fetched, err := s.GetAttendeeByID(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("GetAttendeeByID: %v", err)
	}
	if fetched.CheckedInAt == nil || !fetched.CheckedInAt.Equal(originalAt) {
		t.Fatalf("CheckedInAt = %v, want unchanged original %v", fetched.CheckedInAt, originalAt)
	}
	if fetched.CheckedInDeviceNumber == nil || *fetched.CheckedInDeviceNumber != originalDevice {
		t.Fatalf("CheckedInDeviceNumber = %v, want unchanged original %d", fetched.CheckedInDeviceNumber, originalDevice)
	}
	if fetched.CheckedInPointName == nil || *fetched.CheckedInPointName != originalPoint {
		t.Fatalf("CheckedInPointName = %v, want unchanged original %q", fetched.CheckedInPointName, originalPoint)
	}
	if fetched.CheckedInBy == nil || *fetched.CheckedInBy != originalStaffUserID {
		t.Fatalf("CheckedInBy = %v, want unchanged original %v", fetched.CheckedInBy, originalStaffUserID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestApplyBatchCheckin_DuplicateClientUUIDReturnsDistinctOutcome confirms
// that a true client_uuid replay (the exact same request submitted twice) is
// reported via a distinct outcome value (BatchCheckinDuplicateClientUUID)
// from the "different client_uuid, already checked in" case
// (BatchCheckinAlreadyCheckedIn) — both map to the same "already_exists" HTTP
// status in the handler, but the store layer keeps them distinguishable.
func TestApplyBatchCheckin_DuplicateClientUUIDReturnsDistinctOutcome(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, staffUserID, attendeeID, clientUUID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 7, 11, 9, 30, 0, 0, time.UTC)

	// This client_uuid was already logged — a genuine replay of a
	// previously-processed request. No attendee lookup or write should even
	// be attempted.
	mock.ExpectQuery(`FROM batch_checkin_log WHERE client_uuid`).
		WithArgs(clientUUID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

	s := &PGStore{db: mock}
	item := &models.BatchCheckinItem{
		ClientUUID:   clientUUID,
		AttendeeID:   attendeeID,
		At:           at,
		DeviceNumber: 1,
		Kind:         "checkin",
	}
	outcome, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if outcome != BatchCheckinDuplicateClientUUID {
		t.Fatalf("expected BatchCheckinDuplicateClientUUID, got %v", outcome)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestApplyBatchCheckin_ConcurrentCheckinsRaceSecondCallGetsAlreadyCheckedIn
// is the direct regression test for the TOCTOU race this fix closes: two
// "checkin" items for the SAME attendee, submitted with different
// client_uuids — exactly what two devices scanning the same badge at nearly
// the same moment would produce. Before this fix, ApplyBatchCheckin read
// attendee.CheckinStatus once via GetAttendeeByID and decided whether to
// write from that in-memory value; both near-simultaneous calls could
// observe checkin_status=false and both would then unconditionally call
// UpdateAttendee, with the second silently overwriting the first's
// checked_in_at/checked_in_by/checked_in_device_number/checked_in_point_name
// AND both incorrectly reporting BatchCheckinCreated.
//
// The fix makes the decision atomic at the database level: the guarded
// `UPDATE ... WHERE checkin_status = false` is the sole arbiter. This test
// scripts the first call's guarded UPDATE affecting 1 row (it wins the race)
// and the second call's guarded UPDATE — despite carrying a different
// client_uuid and a GetAttendeeByID read that (as in the real race) still
// observes checkin_status=false — affecting 0 rows, simulating that the
// first call's write already committed in Postgres by the time the second
// call's UPDATE was evaluated. Only one `UPDATE attendees SET checkin_status
// = true ...` exec is scripted per call; if the implementation regressed to
// retrying or rewriting after a 0-row result, pgxmock would fail on an
// unexpected exec.
func TestApplyBatchCheckin_ConcurrentCheckinsRaceSecondCallGetsAlreadyCheckedIn(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, staffUserID, attendeeID := uuid.New(), uuid.New(), uuid.New()
	firstClientUUID, secondClientUUID := uuid.New(), uuid.New()
	now := time.Now()

	firstAt := time.Date(2026, 7, 11, 9, 30, 0, 0, time.UTC)
	firstDevice := 1
	firstPoint := "Стойка А"

	// A second device's near-simultaneous scan of the same badge, a moment
	// later.
	secondAt := time.Date(2026, 7, 11, 9, 30, 1, 0, time.UTC)
	secondDevice := 2
	secondPoint := "Стойка Б"

	// --- First device's request: genuinely wins the race. ---
	mock.ExpectQuery(`FROM batch_checkin_log WHERE client_uuid`).
		WithArgs(firstClientUUID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			false, nil, nil, nil, nil,
			0, nil, false, nil, now, now,
		))
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(firstAt, &staffUserID, &firstDevice, &firstPoint, attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(`INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id, created_at\)`).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "checkin", &staffUserID, &firstAt).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
	mock.ExpectExec(`INSERT INTO batch_checkin_log`).
		WithArgs(firstClientUUID, eventID, attendeeID, "checkin", (*uuid.UUID)(nil), firstDevice, firstAt).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	firstItem := &models.BatchCheckinItem{
		ClientUUID:   firstClientUUID,
		AttendeeID:   attendeeID,
		At:           firstAt,
		DeviceNumber: firstDevice,
		Kind:         "checkin",
		PointName:    &firstPoint,
	}
	firstOutcome, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, firstItem)
	if err != nil {
		t.Fatalf("first ApplyBatchCheckin: %v", err)
	}
	if firstOutcome != BatchCheckinCreated {
		t.Fatalf("expected first call to report BatchCheckinCreated, got %v", firstOutcome)
	}

	// --- Second device's near-simultaneous request for the SAME attendee.
	// Its GetAttendeeByID read still observes checkin_status=false — modeling
	// the actual race window where both reads happen before either write
	// lands. What must differ from the pre-fix behavior is that its guarded
	// UPDATE affects 0 rows (the first call's write already committed by the
	// time this UPDATE's WHERE clause is evaluated), so it must NOT report
	// BatchCheckinCreated and must NOT be followed by any other write
	// attempting to reconcile/overwrite the row.
	mock.ExpectQuery(`FROM batch_checkin_log WHERE client_uuid`).
		WithArgs(secondClientUUID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`FROM attendees WHERE id`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows(attendeeSelectColumns).AddRow(
			attendeeID, eventID, "Jane", "Doe", "jane@example.com", "Acme", "Eng", "CODE1",
			false, nil, nil, nil, nil,
			0, nil, false, nil, now, now,
		))
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(secondAt, &staffUserID, &secondDevice, &secondPoint, attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectCommit()
	mock.ExpectExec(`INSERT INTO batch_checkin_log`).
		WithArgs(secondClientUUID, eventID, attendeeID, "checkin", (*uuid.UUID)(nil), secondDevice, secondAt).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	secondItem := &models.BatchCheckinItem{
		ClientUUID:   secondClientUUID,
		AttendeeID:   attendeeID,
		At:           secondAt,
		DeviceNumber: secondDevice,
		Kind:         "checkin",
		PointName:    &secondPoint,
	}
	secondOutcome, err := s.ApplyBatchCheckin(context.Background(), eventID, staffUserID, secondItem)
	if err != nil {
		t.Fatalf("second ApplyBatchCheckin: %v", err)
	}
	if secondOutcome != BatchCheckinAlreadyCheckedIn {
		t.Fatalf("expected second (racing) call to report BatchCheckinAlreadyCheckedIn, not BatchCheckinCreated — got %v", secondOutcome)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
