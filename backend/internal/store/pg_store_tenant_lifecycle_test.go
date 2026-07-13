package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// UpdateTenantStatus must stamp archived_at when archiving and clear it on
// any other transition (reactivate), in the same statement.
func TestUpdateTenantStatusStampsAndClearsArchivedAt(t *testing.T) {
	for _, status := range []string{"archived", "active"} {
		t.Run(status, func(t *testing.T) {
			mock, err := pgxmock.NewPool()
			if err != nil {
				t.Fatalf("pgxmock.NewPool: %v", err)
			}
			defer mock.Close()
			id := uuid.New()
			mock.ExpectExec(`UPDATE tenants\s+SET status = \$2,\s+archived_at = CASE WHEN \$2 = 'archived' THEN NOW\(\) ELSE NULL END,\s+updated_at = NOW\(\)\s+WHERE id = \$1`).
				WithArgs(id, status).
				WillReturnResult(pgxmock.NewResult("UPDATE", 1))

			s := &PGStore{db: mock}
			if err := s.UpdateTenantStatus(context.Background(), id, status); err != nil {
				t.Fatalf("UpdateTenantStatus: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unmet expectations: %v", err)
			}
		})
	}
}
