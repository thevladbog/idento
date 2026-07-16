package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

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
const updateBadgeTemplateSQL = `UPDATE events\s+SET badge_template = \$1, badge_template_version = badge_template_version \+ 1, updated_at = NOW\(\)\s+WHERE id = \$2 AND badge_template_version = \$3\s+RETURNING badge_template_version`

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

// TestUpdateEventBadgeTemplateVersionMismatchReturnsConflict covers the
// guarded UPDATE hitting 0 rows (expectedVersion stale) for an existing
// event — the store must map that to the exported ErrVersionConflict
// sentinel, not a generic/opaque error.
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
