package store

import (
	"context"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Billing — profiles & catalog (spec 2026-08-25-billing-invoices-design.md)

// UpsertTenantBillingProfile inserts a new profile or updates the existing
// one for p.TenantID (PRIMARY KEY tenant_id — one profile per tenant).
// CreatedAt is preserved across updates; UpdatedAt always advances to NOW().
func (s *PGStore) UpsertTenantBillingProfile(ctx context.Context, p *models.TenantBillingProfile) error {
	query := `INSERT INTO tenant_billing_profiles (tenant_id, legal_name, inn, kpp, legal_address, created_at, updated_at)
	          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
	          ON CONFLICT (tenant_id) DO UPDATE
	          SET legal_name = EXCLUDED.legal_name,
	              inn = EXCLUDED.inn,
	              kpp = EXCLUDED.kpp,
	              legal_address = EXCLUDED.legal_address,
	              updated_at = NOW()
	          RETURNING created_at, updated_at`

	return s.db.QueryRow(ctx, query,
		p.TenantID, p.LegalName, p.INN, p.KPP, p.LegalAddress,
	).Scan(&p.CreatedAt, &p.UpdatedAt)
}

// GetTenantBillingProfile returns (nil, nil) when the tenant has no profile.
func (s *PGStore) GetTenantBillingProfile(ctx context.Context, tenantID uuid.UUID) (*models.TenantBillingProfile, error) {
	query := `SELECT tenant_id, legal_name, inn, kpp, legal_address, created_at, updated_at
	          FROM tenant_billing_profiles WHERE tenant_id = $1`

	var p models.TenantBillingProfile
	err := s.db.QueryRow(ctx, query, tenantID).Scan(
		&p.TenantID, &p.LegalName, &p.INN, &p.KPP, &p.LegalAddress, &p.CreatedAt, &p.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreateCatalogItem inserts a new catalog item and fills item.ID/CreatedAt/
// UpdatedAt from the INSERT's RETURNING clause. The kind-specific column
// consistency (plan/service/addon) is enforced by the billing_catalog_kind_*
// CHECK constraints on billing_catalog_items, not re-validated here.
func (s *PGStore) CreateCatalogItem(ctx context.Context, item *models.BillingCatalogItem) error {
	query := `INSERT INTO billing_catalog_items
	          (kind, name, description, price, vat_rate, is_public, is_active, sort_order,
	           plan_id, period, default_activation,
	           limit_key, limit_delta, validity, validity_days)
	          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
	          RETURNING id, created_at, updated_at`

	return s.db.QueryRow(ctx, query,
		item.Kind, item.Name, item.Description, item.Price, item.VATRate, item.IsPublic, item.IsActive, item.SortOrder,
		item.PlanID, item.Period, item.DefaultActivation,
		item.LimitKey, item.LimitDelta, item.Validity, item.ValidityDays,
	).Scan(&item.ID, &item.CreatedAt, &item.UpdatedAt)
}

// UpdateCatalogItem replaces every mutable column of item.ID and refreshes
// item.UpdatedAt from the UPDATE's RETURNING clause.
func (s *PGStore) UpdateCatalogItem(ctx context.Context, item *models.BillingCatalogItem) error {
	query := `UPDATE billing_catalog_items
	          SET kind = $2, name = $3, description = $4, price = $5, vat_rate = $6,
	              is_public = $7, is_active = $8, sort_order = $9,
	              plan_id = $10, period = $11, default_activation = $12,
	              limit_key = $13, limit_delta = $14, validity = $15, validity_days = $16,
	              updated_at = NOW()
	          WHERE id = $1
	          RETURNING updated_at`

	return s.db.QueryRow(ctx, query,
		item.ID, item.Kind, item.Name, item.Description, item.Price, item.VATRate,
		item.IsPublic, item.IsActive, item.SortOrder,
		item.PlanID, item.Period, item.DefaultActivation,
		item.LimitKey, item.LimitDelta, item.Validity, item.ValidityDays,
	).Scan(&item.UpdatedAt)
}

// GetCatalogItems returns every catalog item ordered by (sort_order, name).
// publicOnly=true restricts to is_public AND is_active rows only (the
// tenant-facing catalog view); publicOnly=false (the operator view) returns
// everything regardless of visibility/activation state.
func (s *PGStore) GetCatalogItems(ctx context.Context, publicOnly bool) ([]*models.BillingCatalogItem, error) {
	query := `SELECT id, kind, name, description, price, vat_rate, is_public, is_active, sort_order,
	                 plan_id, period, default_activation,
	                 limit_key, limit_delta, validity, validity_days,
	                 created_at, updated_at
	          FROM billing_catalog_items`
	if publicOnly {
		query += ` WHERE is_public AND is_active`
	}
	query += ` ORDER BY sort_order, name`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*models.BillingCatalogItem
	for rows.Next() {
		item, err := scanBillingCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// GetCatalogItemByID returns (nil, nil) when absent.
func (s *PGStore) GetCatalogItemByID(ctx context.Context, id uuid.UUID) (*models.BillingCatalogItem, error) {
	query := `SELECT id, kind, name, description, price, vat_rate, is_public, is_active, sort_order,
	                 plan_id, period, default_activation,
	                 limit_key, limit_delta, validity, validity_days,
	                 created_at, updated_at
	          FROM billing_catalog_items WHERE id = $1`

	item, err := scanBillingCatalogItem(s.db.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return item, nil
}

// billingCatalogRowScanner is satisfied by both pgx.Row (QueryRow) and
// pgx.Rows (Query, via its embedded Scan), letting GetCatalogItemByID and
// GetCatalogItems share one column-list/scan definition.
type billingCatalogRowScanner interface {
	Scan(dest ...any) error
}

func scanBillingCatalogItem(row billingCatalogRowScanner) (*models.BillingCatalogItem, error) {
	var item models.BillingCatalogItem
	err := row.Scan(
		&item.ID, &item.Kind, &item.Name, &item.Description, &item.Price, &item.VATRate, &item.IsPublic, &item.IsActive, &item.SortOrder,
		&item.PlanID, &item.Period, &item.DefaultActivation,
		&item.LimitKey, &item.LimitDelta, &item.Validity, &item.ValidityDays,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}
