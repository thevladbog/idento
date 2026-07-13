package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// PurgedTenant identifies a tenant removed by the retention purge.
type PurgedTenant struct {
	ID   uuid.UUID
	Name string
}

// errTenantNoLongerEligible signals that a purge candidate stopped matching
// the purge conditions between listing and deletion (e.g. it was reactivated).
var errTenantNoLongerEligible = errors.New("tenant no longer eligible for purge")

// PurgeExpiredTenants hard-deletes tenants archived more than retentionDays
// ago. Per tenant, in one transaction: users that must survive (super admins,
// members of other tenants) are detached, the tenant row is deleted (FKs
// cascade all tenant data), and a purge_tenant audit entry with no admin
// actor is written. One tenant failing does not stop the rest; the combined
// error is returned alongside the successfully purged list.
func (s *PGStore) PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]PurgedTenant, error) {
	rows, err := s.db.Query(ctx, `SELECT id, name, archived_at FROM tenants
		WHERE status = 'archived' AND archived_at < NOW() - make_interval(days => $1)`, retentionDays)
	if err != nil {
		return nil, fmt.Errorf("list expired archived tenants: %w", err)
	}
	type candidate struct {
		id         uuid.UUID
		name       string
		archivedAt time.Time
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.name, &c.archivedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan expired tenant: %w", err)
		}
		candidates = append(candidates, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var purged []PurgedTenant
	var errs []error
	for _, c := range candidates {
		if err := s.purgeTenant(ctx, c.id, c.name, c.archivedAt, retentionDays); err != nil {
			if errors.Is(err, errTenantNoLongerEligible) {
				continue
			}
			errs = append(errs, fmt.Errorf("purge tenant %s (%s): %w", c.id, c.name, err))
			continue
		}
		purged = append(purged, PurgedTenant{ID: c.id, Name: c.name})
	}
	return purged, errors.Join(errs...)
}

func (s *PGStore) purgeTenant(ctx context.Context, id uuid.UUID, name string, archivedAt time.Time, retentionDays int) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	//nolint:errcheck
	defer tx.Rollback(ctx) // no-op after Commit

	// Detach users that must survive the cascade: super admins, users with
	// memberships in other tenants, and users with admin_audit_log actor rows
	// (e.g. a demoted ex-super-admin) — that table's NO ACTION FK would
	// otherwise block the tenant delete. Their user_tenants row for this
	// tenant still cascades away with the tenant.
	if _, err := tx.Exec(ctx, `UPDATE users SET tenant_id = NULL
		WHERE tenant_id = $1
		  AND (is_super_admin OR EXISTS (
		      SELECT 1 FROM user_tenants ut WHERE ut.user_id = users.id AND ut.tenant_id <> $1)
		  OR EXISTS (
		      SELECT 1 FROM admin_audit_log al WHERE al.admin_user_id = users.id))`, id); err != nil {
		return fmt.Errorf("detach shared users: %w", err)
	}

	tag, err := tx.Exec(ctx, `DELETE FROM tenants
		WHERE id = $1 AND status = 'archived' AND archived_at < NOW() - make_interval(days => $2)`, id, retentionDays)
	if err != nil {
		return fmt.Errorf("delete tenant: %w", err)
	}
	// Re-verified inside the transaction: if the tenant was reactivated (or
	// already purged by another replica) since the candidate SELECT, roll
	// back the detach and skip — no audit entry, not counted as purged.
	if tag.RowsAffected() == 0 {
		return errTenantNoLongerEligible
	}

	changes, err := json.Marshal(map[string]interface{}{
		"name":           name,
		"archived_at":    archivedAt,
		"retention_days": retentionDays,
	})
	if err != nil {
		return err
	}
	// The permanent record that survives the purge (admin_user_id NULL =
	// system actor; column made nullable in migration 000017).
	if _, err := tx.Exec(ctx, `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, changes)
		VALUES (NULL, 'purge_tenant', 'tenant', $1, $2)`, id, changes); err != nil {
		return fmt.Errorf("write purge audit entry: %w", err)
	}
	return tx.Commit(ctx)
}
