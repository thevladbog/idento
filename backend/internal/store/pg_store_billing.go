package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

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

// invoiceColumnsSQL is the invoices column list shared by GetInvoiceByID and
// ListInvoices (minus ListInvoices' extra joined tenant_name).
const invoiceColumnsSQL = `id, number, tenant_id, status, issued_at, paid_at, cancelled_at,
	buyer_name, buyer_inn, buyer_kpp, buyer_address,
	seller_name, seller_inn, seller_bank_name, seller_bank_account, seller_bank_bik, seller_bank_corr_account,
	total, comment, created_by, created_at, updated_at`

// scanInvoice scans one invoices row using invoiceColumnsSQL's column order.
func scanInvoice(row billingCatalogRowScanner, inv *models.Invoice) error {
	return row.Scan(
		&inv.ID, &inv.Number, &inv.TenantID, &inv.Status, &inv.IssuedAt, &inv.PaidAt, &inv.CancelledAt,
		&inv.BuyerName, &inv.BuyerINN, &inv.BuyerKPP, &inv.BuyerAddress,
		&inv.SellerName, &inv.SellerINN, &inv.SellerBankName, &inv.SellerBankAccount, &inv.SellerBankBIK, &inv.SellerBankCorrAccount,
		&inv.Total, &inv.Comment, &inv.CreatedBy, &inv.CreatedAt, &inv.UpdatedAt,
	)
}

// CreateInvoice assigns inv.Number (СЧ-<year>-<NNNN>, incrementing a
// per-year counter in invoice_counters) and inserts the invoice plus its
// lines atomically, filling inv.ID/IssuedAt/CreatedAt/UpdatedAt and each
// line's ID/InvoiceID. Lines must arrive with Position/snapshot fields/
// Quantity/Amount already set — no validation/derivation happens here.
//
// Opens its own transaction (s.db.Begin): inside a handler's WithTx this
// nests as a savepoint via pgx.Tx.Begin, the same established pattern as
// CreateTenantWithDefaultSubscription.
func (s *PGStore) CreateInvoice(ctx context.Context, inv *models.Invoice, lines []*models.InvoiceLine) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Printf("rollback CreateInvoice: %v", err)
		}
	}()

	year := time.Now().Year()
	var n int
	if err := tx.QueryRow(ctx, `INSERT INTO invoice_counters (year, last_value) VALUES ($1, 1)
	    ON CONFLICT (year) DO UPDATE SET last_value = invoice_counters.last_value + 1
	    RETURNING last_value`, year).Scan(&n); err != nil {
		return fmt.Errorf("assign invoice number: %w", err)
	}
	inv.Number = fmt.Sprintf("СЧ-%d-%04d", year, n)

	if inv.Status == "" {
		inv.Status = "issued"
	}

	query := `INSERT INTO invoices
	          (number, tenant_id, status, buyer_name, buyer_inn, buyer_kpp, buyer_address,
	           seller_name, seller_inn, seller_bank_name, seller_bank_account, seller_bank_bik, seller_bank_corr_account,
	           total, comment, created_by)
	          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	          RETURNING id, issued_at, created_at, updated_at`
	if err := tx.QueryRow(ctx, query,
		inv.Number, inv.TenantID, inv.Status, inv.BuyerName, inv.BuyerINN, inv.BuyerKPP, inv.BuyerAddress,
		inv.SellerName, inv.SellerINN, inv.SellerBankName, inv.SellerBankAccount, inv.SellerBankBIK, inv.SellerBankCorrAccount,
		inv.Total, inv.Comment, inv.CreatedBy,
	).Scan(&inv.ID, &inv.IssuedAt, &inv.CreatedAt, &inv.UpdatedAt); err != nil {
		return fmt.Errorf("insert invoice: %w", err)
	}

	lineQuery := `INSERT INTO invoice_lines
	              (invoice_id, position, catalog_item_id, kind, name, price, vat_rate,
	               plan_id, period, activation, limit_key, limit_delta, validity, validity_days,
	               quantity, amount)
	              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	              RETURNING id`
	for _, line := range lines {
		line.InvoiceID = inv.ID
		if err := tx.QueryRow(ctx, lineQuery,
			inv.ID, line.Position, line.CatalogItemID, line.Kind, line.Name, line.Price, line.VATRate,
			line.PlanID, line.Period, line.Activation, line.LimitKey, line.LimitDelta, line.Validity, line.ValidityDays,
			line.Quantity, line.Amount,
		).Scan(&line.ID); err != nil {
			return fmt.Errorf("insert invoice line (position %d): %w", line.Position, err)
		}
	}
	inv.Lines = lines

	return tx.Commit(ctx)
}

// GetInvoiceByID returns the invoice with Lines loaded ordered by position,
// (nil, nil) when absent.
func (s *PGStore) GetInvoiceByID(ctx context.Context, id uuid.UUID) (*models.Invoice, error) {
	query := `SELECT ` + invoiceColumnsSQL + ` FROM invoices WHERE id = $1`

	var inv models.Invoice
	if err := scanInvoice(s.db.QueryRow(ctx, query, id), &inv); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	lineQuery := `SELECT id, invoice_id, position, catalog_item_id, kind, name, price, vat_rate,
	                     plan_id, period, activation, limit_key, limit_delta, validity, validity_days,
	                     quantity, amount
	              FROM invoice_lines WHERE invoice_id = $1 ORDER BY position`
	rows, err := s.db.Query(ctx, lineQuery, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lines []*models.InvoiceLine
	for rows.Next() {
		var line models.InvoiceLine
		if err := rows.Scan(
			&line.ID, &line.InvoiceID, &line.Position, &line.CatalogItemID, &line.Kind, &line.Name, &line.Price, &line.VATRate,
			&line.PlanID, &line.Period, &line.Activation, &line.LimitKey, &line.LimitDelta, &line.Validity, &line.ValidityDays,
			&line.Quantity, &line.Amount,
		); err != nil {
			return nil, err
		}
		lines = append(lines, &line)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	inv.Lines = lines

	return &inv, nil
}

// ListInvoices returns invoices (no lines) newest-first with TenantName
// LEFT JOIN-ed from tenants (empty string when the tenant row is gone).
// f.TenantID nil and f.Status "" each skip that filter; f.Limit<=0 defaults
// to 100.
func (s *PGStore) ListInvoices(ctx context.Context, f InvoiceFilter) ([]*models.Invoice, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 100
	}

	query := `SELECT i.id, i.number, i.tenant_id, i.status, i.issued_at, i.paid_at, i.cancelled_at,
	                 i.buyer_name, i.buyer_inn, i.buyer_kpp, i.buyer_address,
	                 i.seller_name, i.seller_inn, i.seller_bank_name, i.seller_bank_account, i.seller_bank_bik, i.seller_bank_corr_account,
	                 i.total, i.comment, i.created_by, i.created_at, i.updated_at,
	                 COALESCE(t.name, '') AS tenant_name
	          FROM invoices i
	          LEFT JOIN tenants t ON t.id = i.tenant_id
	          WHERE ($1::uuid IS NULL OR i.tenant_id = $1)
	            AND ($2::text = '' OR i.status = $2)
	          ORDER BY i.issued_at DESC
	          LIMIT $3 OFFSET $4`

	rows, err := s.db.Query(ctx, query, f.TenantID, f.Status, limit, f.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var invoices []*models.Invoice
	for rows.Next() {
		var inv models.Invoice
		if err := rows.Scan(
			&inv.ID, &inv.Number, &inv.TenantID, &inv.Status, &inv.IssuedAt, &inv.PaidAt, &inv.CancelledAt,
			&inv.BuyerName, &inv.BuyerINN, &inv.BuyerKPP, &inv.BuyerAddress,
			&inv.SellerName, &inv.SellerINN, &inv.SellerBankName, &inv.SellerBankAccount, &inv.SellerBankBIK, &inv.SellerBankCorrAccount,
			&inv.Total, &inv.Comment, &inv.CreatedBy, &inv.CreatedAt, &inv.UpdatedAt,
			&inv.TenantName,
		); err != nil {
			return nil, err
		}
		invoices = append(invoices, &inv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return invoices, nil
}
