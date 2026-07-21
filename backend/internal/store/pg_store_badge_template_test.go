package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// getBadgeTemplateSQL matches the exact SELECT GetEventBadgeTemplate must
// issue against the dedicated badge_template/badge_template_version columns
// (never the legacy custom_fields["badgeTemplate"] key).
const getBadgeTemplateSQL = `SELECT badge_template, badge_template_version FROM events WHERE id = \$1 AND deleted_at IS NULL`

// updateBadgeTemplateSQL matches the guarded, optimistic-concurrency UPDATE
// from reconciliation #9: it only touches a row whose current
// badge_template_version equals the caller's expectedVersion, and bumps it.
// It must also exclude soft-deleted rows (final-review Minor 6) — every
// other events UPDATE in this file already does, and a guarded write with
// no expectedVersion match left is otherwise the one UPDATE that could
// "resurrect" a soft-deleted event's badge template. P5.2 removed the
// transitional jsonb_set mirror into custom_fields["badgeTemplate"] — this
// statement now touches ONLY the badge_template/badge_template_version
// columns.
const updateBadgeTemplateSQL = `UPDATE events\s+SET badge_template = \$1, badge_template_version = badge_template_version \+ 1, updated_at = NOW\(\)\s+WHERE id = \$2 AND badge_template_version = \$3 AND deleted_at IS NULL\s+RETURNING badge_template_version`

func TestGetEventBadgeTemplateReturnsTemplateAndVersion(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	templateJSON := []byte(`{"elements":[],"customFont":"X"}`)
	mock.ExpectQuery(getBadgeTemplateSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"badge_template", "badge_template_version"}).
			AddRow(templateJSON, 3))

	s := &PGStore{db: mock}
	template, version, err := s.GetEventBadgeTemplate(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetEventBadgeTemplate: %v", err)
	}
	if version != 3 {
		t.Errorf("version = %d, want 3", version)
	}
	if !json.Valid(template) || string(template) != string(templateJSON) {
		t.Errorf("template = %s, want %s", template, templateJSON)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetEventBadgeTemplateNullColumnReturnsZeroValue covers the "no
// template saved yet" case: badge_template is NULL (scanned as a nil/empty
// byte slice) — the store must never fabricate a template, just report the
// zero value.
func TestGetEventBadgeTemplateNullColumnReturnsZeroValue(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getBadgeTemplateSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"badge_template", "badge_template_version"}).
			AddRow(nil, 0))

	s := &PGStore{db: mock}
	template, version, err := s.GetEventBadgeTemplate(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetEventBadgeTemplate: %v", err)
	}
	if template != nil {
		t.Errorf("template = %v, want nil", template)
	}
	if version != 0 {
		t.Errorf("version = %d, want 0", version)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestUpdateEventBadgeTemplateReturnsBumpedVersion(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	template := json.RawMessage(`{"elements":[],"customFont":"X"}`)
	mock.ExpectQuery(updateBadgeTemplateSQL).
		WithArgs([]byte(template), eventID, 3).
		WillReturnRows(pgxmock.NewRows([]string{"badge_template_version"}).AddRow(4))

	s := &PGStore{db: mock}
	newVersion, err := s.UpdateEventBadgeTemplate(context.Background(), eventID, template, 3)
	if err != nil {
		t.Fatalf("UpdateEventBadgeTemplate: %v", err)
	}
	if newVersion != 4 {
		t.Errorf("newVersion = %d, want 4", newVersion)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUpdateEventBadgeTemplateDoesNotTouchCustomFields pins P5.2's removal
// of the transitional jsonb_set mirror: the guarded UPDATE's SQL text must
// no longer reference jsonb_set(...) or custom_fields at all —
// updateBadgeTemplateSQL (now column-only) is the ExpectQuery match target,
// so a pre-P5.2 query containing the mirror fragment would fail to match
// and this test would fail with an unmet-expectations error, not silently
// pass.
func TestUpdateEventBadgeTemplateDoesNotTouchCustomFields(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	template := json.RawMessage(`{"elements":[{"id":"e1","text":"Café \"VIP\""}],"customFont":"X"}`)
	mock.ExpectQuery(updateBadgeTemplateSQL).
		WithArgs([]byte(template), eventID, 7).
		WillReturnRows(pgxmock.NewRows([]string{"badge_template_version"}).AddRow(8))

	s := &PGStore{db: mock}
	newVersion, err := s.UpdateEventBadgeTemplate(context.Background(), eventID, template, 7)
	if err != nil {
		t.Fatalf("UpdateEventBadgeTemplate: %v", err)
	}
	if newVersion != 8 {
		t.Errorf("newVersion = %d, want 8", newVersion)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations (query text must be column-only, no jsonb_set/custom_fields mirror): %v", err)
	}
}

// TestUpdateEventBadgeTemplateVersionMismatchReturnsConflict covers the
// guarded UPDATE hitting 0 rows (expectedVersion stale) for an existing
// event — the store must map that to the exported ErrVersionConflict
// sentinel, not a generic/opaque error.
// getEventByIDSQL matches GetEventByID's SELECT once it's extended (P3.1) to
// also read the badge_template/badge_template_version columns alongside the
// pre-existing fields. requireEventOwnership (and every other event-fetch
// path that calls GetEventByID/GetEventByIDForTenant) must see these columns
// without a second store round-trip, or handler/badge_zpl.go and
// handler/readiness.go can't apply the column-first fallback rule
// (reconciliation #7/#8).
const getEventByIDSQL = `SELECT id, tenant_id, name, start_date, end_date, location, field_schema, custom_fields, badge_template, badge_template_version, created_at, updated_at FROM events WHERE id = \$1 AND deleted_at IS NULL`

// TestGetEventByIDScansBadgeTemplateColumn proves the extended SELECT scans
// badge_template/badge_template_version into the right Event fields — and,
// crucially, that adding these two columns to the middle of the column list
// doesn't shift any of the pre-existing scans (custom_fields still lands in
// CustomFields, not clobbered by the new columns).
func TestGetEventByIDScansBadgeTemplateColumn(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	tenantID := uuid.New()
	now := time.Now()
	customFieldsJSON := []byte(`{"badgeTemplate":"legacy-stale"}`)
	templateJSON := []byte(`{"width_mm":50,"height_mm":30,"dpi":203,"elements":[{"id":"e1"}]}`)

	mock.ExpectQuery(getEventByIDSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "start_date", "end_date", "location",
			"field_schema", "custom_fields", "badge_template", "badge_template_version",
			"created_at", "updated_at",
		}).AddRow(eventID, tenantID, "Tech Summit", nil, nil, "Main Hall", nil, customFieldsJSON, templateJSON, 3, now, now))

	s := &PGStore{db: mock}
	event, err := s.GetEventByID(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetEventByID: %v", err)
	}
	if event == nil {
		t.Fatal("event = nil, want a populated Event")
	}
	if event.BadgeTemplateVersion != 3 {
		t.Errorf("BadgeTemplateVersion = %d, want 3", event.BadgeTemplateVersion)
	}
	if string(event.BadgeTemplate) != string(templateJSON) {
		t.Errorf("BadgeTemplate = %s, want %s", event.BadgeTemplate, templateJSON)
	}
	if event.CustomFields["badgeTemplate"] != "legacy-stale" {
		t.Errorf("CustomFields not scanned correctly (columns shifted?): %+v", event.CustomFields)
	}
	if event.Name != "Tech Summit" || event.Location != "Main Hall" {
		t.Errorf("other columns not scanned correctly: name=%q location=%q", event.Name, event.Location)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetEventByIDNullBadgeTemplateColumnLeavesZeroValue covers the "no
// column template saved yet" case: badge_template is NULL and
// badge_template_version is its DEFAULT 0 (per migration 000018) — the Event
// must come back with a nil BadgeTemplate and BadgeTemplateVersion 0, never a
// fabricated value.
func TestGetEventByIDNullBadgeTemplateColumnLeavesZeroValue(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	tenantID := uuid.New()
	now := time.Now()

	mock.ExpectQuery(getEventByIDSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "start_date", "end_date", "location",
			"field_schema", "custom_fields", "badge_template", "badge_template_version",
			"created_at", "updated_at",
		}).AddRow(eventID, tenantID, "Tech Summit", nil, nil, "Main Hall", nil, nil, nil, 0, now, now))

	s := &PGStore{db: mock}
	event, err := s.GetEventByID(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetEventByID: %v", err)
	}
	if event.BadgeTemplate != nil {
		t.Errorf("BadgeTemplate = %s, want nil", event.BadgeTemplate)
	}
	if event.BadgeTemplateVersion != 0 {
		t.Errorf("BadgeTemplateVersion = %d, want 0", event.BadgeTemplateVersion)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestUpdateEventBadgeTemplateVersionMismatchReturnsConflict(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	template := json.RawMessage(`{"elements":[]}`)
	mock.ExpectQuery(updateBadgeTemplateSQL).
		WithArgs([]byte(template), eventID, 1).
		WillReturnRows(pgxmock.NewRows([]string{"badge_template_version"}))

	s := &PGStore{db: mock}
	newVersion, err := s.UpdateEventBadgeTemplate(context.Background(), eventID, template, 1)
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("err = %v, want ErrVersionConflict", err)
	}
	if newVersion != 0 {
		t.Errorf("newVersion = %d, want 0", newVersion)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
