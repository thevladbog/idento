# Billing: Catalog, Invoices, Limit Add-ons, Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bank-transfer B2B invoicing: an operator-managed catalog (plan / service / limit-addon items), invoices issued by tenant or operator, mark-paid that applies subscription/limit effects atomically, plus the first subscription-lifecycle automation (trial/active → expired).

**Architecture:** New migration 000029 adds 6 tables (billing profiles, catalog, invoices+lines+counters, limit_boosts). Store gains a billing method family (pg_store_billing.go); `resolveTenantLimit` adds active-boost deltas so every existing enforcement point honors add-ons with zero per-callsite changes. Handlers split tenant-facing (openapi-documented, panel) and super-admin (console). A retention-style ticker (`internal/billing`) expires overdue subscriptions. Print view = print-friendly HTML in both frontends; «сумма прописью» computed server-side.

**Tech Stack:** Go/echo/pgx, golang-migrate SQL files, React+TS (panel: openapi-fetch/react-query/MSW; web: axios/useState), vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-billing-invoices-design.md` — binding.

## Global Constraints

- Money is rubles only. Frontend display: `value.toLocaleString('ru-RU')` + ` ₽`.
- Invoice number format: `СЧ-<year>-<NNNN>` (NNNN zero-padded to 4, per-year sequence), e.g. `СЧ-2026-0001`.
- Invoice statuses: `issued`, `paid`, `cancelled`. Transitions ONLY `issued→paid` and `issued→cancelled`; anything else is 409.
- Catalog kinds: `plan`, `service`, `addon`. Activation modes: `on_payment`, `after_current`, `manual`. Addon validity: `until_period_end`, `fixed_days`. Limit keys: `attendees_per_event`, `events_per_month`, `users`.
- VAT: `vat_rate` NULL = «Без НДС» (default). A set rate means the price INCLUDES VAT; displayed as «В том числе НДС X%», computed as `amount × rate / (100 + rate)` rounded to kopecks.
- All billing surfaces are SaaS-only: tenant billing routes and super-admin billing routes mount only under `mode == config.ModeSaaS`; the lifecycle ticker starts only in SaaS mode.
- Tenant-facing billing endpoints require tenant role `admin` (403 otherwise).
- `admin_audit_log.admin_user_id` is nullable (migration 000017); system actions (lifecycle ticker) insert audit rows with NULL actor directly in SQL — do NOT use `LogAdminAction` for them.
- Any `backend/openapi.yaml` edit requires `npm run generate:api -w panel` run and the regenerated `panel/src/shared/api/schema.d.ts` committed in the SAME task (CI drift check).
- Panel typecheck is `npm run typecheck -w panel` (NEVER bare `tsc`). Panel lint via `rtk proxy npm run lint -w panel`.
- Panel i18n: every new key goes to BOTH `panel/src/shared/i18n/en.json` and `ru.json` (flat camelCase; `keyParity.test.ts` enforces parity). Web i18n: both `en` and `ru` blocks of `web/src/i18n.ts` (`i18n-key-usage.test.ts` enforces usage).
- Backend gates per task: `cd backend && go build ./... && go test -count=1 ./...` (integration tests need `docker compose up -d db` at repo root and `TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable"`), plus `golangci-lint run ./internal/...`.
- Go sources must not contain a literal UTF-8 BOM (compile error). Cyrillic string literals (`СЧ-`, «Без НДС») are fine.
- Commits end with trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- `backend/migrations/000029_billing_invoices.{up,down}.sql` — new tables.
- `backend/internal/models/models.go` — append billing models.
- `backend/internal/store/interface.go` — billing method family + lifecycle method.
- `backend/internal/store/pg_store_billing.go` — all billing SQL (new file; keep pg_store.go untouched except `resolveTenantLimit`).
- `backend/internal/store/pg_store_billing_migration_test.go`, `pg_store_billing_integration_test.go`, `pg_store_lifecycle_integration_test.go` — tests.
- `backend/internal/billing/lifecycle.go` (+`_test.go`) — expiry ticker (mirror of `internal/retention`).
- `backend/internal/billing/amountwords.go` (+`_test.go`) — «сумма прописью».
- `backend/internal/config/config.go` — seller requisites + ticker interval.
- `backend/internal/handler/billing_tenant.go` (+`_test.go`) — panel endpoints.
- `backend/internal/handler/billing_super.go` (+`_test.go`) — console endpoints.
- `backend/internal/handler/handler.go` — route wiring.
- `backend/main.go` — ticker start.
- `backend/openapi.yaml` + `panel/src/shared/api/schema.d.ts` (regenerated).
- `panel/src/features/billing/` — `BillingPage.tsx`, `InvoicePrintPage.tsx`, `hooks.ts`, tests; `panel/src/app/router.tsx`, `panel/src/app/shell/NavDrawer.tsx`, i18n jsons.
- `web/src/pages/super-admin/BillingCatalog.tsx`, `BillingInvoices.tsx`, `InvoicePrint.tsx` + `__tests__/`; `web/src/App.tsx`, `SuperAdminLayout.tsx`, `OrganizationDetail.tsx`, `web/src/i18n.ts`.
- `web/src/lib/vat.ts` and `panel/src/features/billing/vat.ts` — included-VAT math helper (duplicated by design; web is not a workspace member).

---

### Task 1: Migration 000029 — billing tables

**Files:**
- Create: `backend/migrations/000029_billing_invoices.up.sql`
- Create: `backend/migrations/000029_billing_invoices.down.sql`
- Test: `backend/internal/store/pg_store_billing_migration_test.go`

**Interfaces:**
- Produces: tables `tenant_billing_profiles`, `billing_catalog_items`, `invoice_counters`, `invoices`, `invoice_lines`, `limit_boosts` exactly as below — later tasks' SQL depends on these column names verbatim.

- [ ] **Step 1: Write the failing migration content test**

`backend/internal/store/pg_store_billing_migration_test.go` (same style as `pg_store_russify_plans_test.go` — read files relative to `runtime.Caller`):

```go
package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestBillingMigrationShape pins migration 000029: kind-consistency CHECKs,
// status enum, per-year counter, snapshot columns, and full down-migration.
func TestBillingMigrationShape(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	dir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(dir, "000029_billing_invoices.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(dir, "000029_billing_invoices.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.ToLower(string(downBytes))

	for _, fragment := range []string{
		"create table if not exists tenant_billing_profiles",
		"create table if not exists billing_catalog_items",
		"create table if not exists invoice_counters",
		"create table if not exists invoices",
		"create table if not exists invoice_lines",
		"create table if not exists limit_boosts",
		"kind in ('plan','service','addon')",
		"status in ('issued','paid','cancelled')",
		"period in ('month','year')",
		"default_activation in ('on_payment','after_current','manual')",
		"limit_key in ('attendees_per_event','events_per_month','users')",
		"validity in ('until_period_end','fixed_days')",
		"constraint billing_catalog_kind_plan check",
		"constraint billing_catalog_kind_addon check",
		"constraint billing_catalog_kind_service check",
		"number text not null unique",
		"quantity int not null check (quantity >= 1)",
		"valid_until timestamptz not null",
	} {
		if !strings.Contains(up, fragment) {
			t.Errorf("up migration missing %q", fragment)
		}
	}
	for _, table := range []string{
		"limit_boosts", "invoice_lines", "invoices", "invoice_counters",
		"billing_catalog_items", "tenant_billing_profiles",
	} {
		if !strings.Contains(down, "drop table if exists "+table) {
			t.Errorf("down migration missing drop of %s", table)
		}
	}
}
```

- [ ] **Step 2: Run it, verify FAIL** — `cd backend && go test -count=1 ./internal/store/ -run TestBillingMigrationShape` → FAIL (file not found).

- [ ] **Step 3: Write `000029_billing_invoices.up.sql`**

```sql
-- Billing: catalog, bank-transfer invoices, limit add-ons.
-- Spec: docs/superpowers/specs/2026-08-25-billing-invoices-design.md

CREATE TABLE IF NOT EXISTS tenant_billing_profiles (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    legal_name TEXT NOT NULL,
    inn TEXT NOT NULL,
    kpp TEXT,
    legal_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('plan','service','addon')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    vat_rate NUMERIC(4,2) CHECK (vat_rate > 0),
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    -- kind = 'plan'
    plan_id UUID REFERENCES subscription_plans(id),
    period TEXT CHECK (period IN ('month','year')),
    default_activation TEXT CHECK (default_activation IN ('on_payment','after_current','manual')),
    -- kind = 'addon'
    limit_key TEXT CHECK (limit_key IN ('attendees_per_event','events_per_month','users')),
    limit_delta INT CHECK (limit_delta > 0),
    validity TEXT CHECK (validity IN ('until_period_end','fixed_days')),
    validity_days INT CHECK (validity_days > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_catalog_kind_plan CHECK (
        kind <> 'plan' OR (plan_id IS NOT NULL AND period IS NOT NULL AND default_activation IS NOT NULL
            AND limit_key IS NULL AND limit_delta IS NULL AND validity IS NULL AND validity_days IS NULL)),
    CONSTRAINT billing_catalog_kind_addon CHECK (
        kind <> 'addon' OR (limit_key IS NOT NULL AND limit_delta IS NOT NULL AND validity IS NOT NULL
            AND (validity <> 'fixed_days' OR validity_days IS NOT NULL)
            AND plan_id IS NULL AND period IS NULL AND default_activation IS NULL)),
    CONSTRAINT billing_catalog_kind_service CHECK (
        kind <> 'service' OR (plan_id IS NULL AND period IS NULL AND default_activation IS NULL
            AND limit_key IS NULL AND limit_delta IS NULL AND validity IS NULL AND validity_days IS NULL))
);

-- Per-year invoice-number sequence (СЧ-<year>-<NNNN>). Row per year;
-- UPSERT-increment inside the issuing transaction serializes numbering.
CREATE TABLE IF NOT EXISTS invoice_counters (
    year INT PRIMARY KEY,
    last_value INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number TEXT NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','paid','cancelled')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    -- buyer requisites snapshot (from tenant_billing_profiles at issue time)
    buyer_name TEXT NOT NULL,
    buyer_inn TEXT NOT NULL,
    buyer_kpp TEXT,
    buyer_address TEXT NOT NULL,
    -- seller requisites snapshot (from backend config at issue time)
    seller_name TEXT NOT NULL,
    seller_inn TEXT NOT NULL,
    seller_bank_name TEXT NOT NULL,
    seller_bank_account TEXT NOT NULL,
    seller_bank_bik TEXT NOT NULL,
    seller_bank_corr_account TEXT,
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    comment TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, issued_at DESC);

-- Full snapshot of the catalog item at issue time: later catalog edits must
-- never mutate issued invoices (spec, Data model).
CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position INT NOT NULL,
    catalog_item_id UUID REFERENCES billing_catalog_items(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('plan','service','addon')),
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    vat_rate NUMERIC(4,2),
    plan_id UUID REFERENCES subscription_plans(id),
    period TEXT,
    activation TEXT,
    limit_key TEXT,
    limit_delta INT,
    validity TEXT,
    validity_days INT,
    quantity INT NOT NULL CHECK (quantity >= 1),
    amount NUMERIC(12,2) NOT NULL,
    UNIQUE (invoice_id, position)
);

-- Deliberately a snapshot date: extending the subscription later does NOT
-- stretch an old boost («разово и до завершения текущей подписки»).
CREATE TABLE IF NOT EXISTS limit_boosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    limit_key TEXT NOT NULL CHECK (limit_key IN ('attendees_per_event','events_per_month','users')),
    delta INT NOT NULL CHECK (delta > 0),
    valid_until TIMESTAMPTZ NOT NULL,
    source_invoice_line_id UUID REFERENCES invoice_lines(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_limit_boosts_tenant ON limit_boosts(tenant_id, limit_key, valid_until);
```

- [ ] **Step 4: Write `000029_billing_invoices.down.sql`**

```sql
DROP TABLE IF EXISTS limit_boosts;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS invoice_counters;
DROP TABLE IF EXISTS billing_catalog_items;
DROP TABLE IF EXISTS tenant_billing_profiles;
```

- [ ] **Step 5: Run test → PASS.** Also run the migration for real: with the dev DB up, `cd backend && go test -count=1 ./internal/store/ -run TestMigrations` if an apply-test exists (see `pg_store_migrations_test.go`); at minimum `go build ./...`. Integration tests in later tasks apply migrations automatically.

- [ ] **Step 6: Commit** — `feat(billing): migration 000029 — catalog, invoices, limit boosts tables`

---

### Task 2: Models + store — billing profiles & catalog

**Files:**
- Modify: `backend/internal/models/models.go` (append at end)
- Modify: `backend/internal/store/interface.go` (new `// Billing` section before the `// WithTx` comment block)
- Create: `backend/internal/store/pg_store_billing.go`
- Test: `backend/internal/store/pg_store_billing_integration_test.go`

**Interfaces:**
- Produces (models — verbatim, later tasks depend on field names):

```go
// --- Billing (bank-transfer invoicing; spec 2026-08-25) ---

type TenantBillingProfile struct {
	TenantID     uuid.UUID `json:"tenant_id"`
	LegalName    string    `json:"legal_name"`
	INN          string    `json:"inn"`
	KPP          *string   `json:"kpp"`
	LegalAddress string    `json:"legal_address"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type BillingCatalogItem struct {
	ID          uuid.UUID `json:"id"`
	Kind        string    `json:"kind"` // plan, service, addon
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Price       float64   `json:"price"`
	VATRate     *float64  `json:"vat_rate"` // nil = «Без НДС»; value = included in price
	IsPublic    bool      `json:"is_public"`
	IsActive    bool      `json:"is_active"`
	SortOrder   int       `json:"sort_order"`
	// kind == "plan"
	PlanID            *uuid.UUID `json:"plan_id"`
	Period            *string    `json:"period"`             // month, year
	DefaultActivation *string    `json:"default_activation"` // on_payment, after_current, manual
	// kind == "addon"
	LimitKey     *string `json:"limit_key"` // attendees_per_event, events_per_month, users
	LimitDelta   *int    `json:"limit_delta"`
	Validity     *string `json:"validity"` // until_period_end, fixed_days
	ValidityDays *int    `json:"validity_days"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Invoice struct {
	ID          uuid.UUID  `json:"id"`
	Number      string     `json:"number"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	Status      string     `json:"status"` // issued, paid, cancelled
	IssuedAt    time.Time  `json:"issued_at"`
	PaidAt      *time.Time `json:"paid_at"`
	CancelledAt *time.Time `json:"cancelled_at"`
	BuyerName    string  `json:"buyer_name"`
	BuyerINN     string  `json:"buyer_inn"`
	BuyerKPP     *string `json:"buyer_kpp"`
	BuyerAddress string  `json:"buyer_address"`
	SellerName            string  `json:"seller_name"`
	SellerINN             string  `json:"seller_inn"`
	SellerBankName        string  `json:"seller_bank_name"`
	SellerBankAccount     string  `json:"seller_bank_account"`
	SellerBankBIK         string  `json:"seller_bank_bik"`
	SellerBankCorrAccount *string `json:"seller_bank_corr_account"`
	Total     float64    `json:"total"`
	Comment   *string    `json:"comment"`
	CreatedBy *uuid.UUID `json:"created_by"`
	// TenantName is joined for operator list views; empty elsewhere.
	TenantName string         `json:"tenant_name,omitempty"`
	Lines      []*InvoiceLine `json:"lines,omitempty"`
	// TotalInWords is computed by handlers (billing.AmountInWords), never stored.
	TotalInWords string    `json:"total_in_words,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type InvoiceLine struct {
	ID            uuid.UUID  `json:"id"`
	InvoiceID     uuid.UUID  `json:"invoice_id"`
	Position      int        `json:"position"`
	CatalogItemID *uuid.UUID `json:"catalog_item_id"`
	Kind          string     `json:"kind"`
	Name          string     `json:"name"`
	Price         float64    `json:"price"`
	VATRate       *float64   `json:"vat_rate"`
	PlanID        *uuid.UUID `json:"plan_id"`
	Period        *string    `json:"period"`
	Activation    *string    `json:"activation"`
	LimitKey      *string    `json:"limit_key"`
	LimitDelta    *int       `json:"limit_delta"`
	Validity      *string    `json:"validity"`
	ValidityDays  *int       `json:"validity_days"`
	Quantity      int        `json:"quantity"`
	Amount        float64    `json:"amount"`
}

type LimitBoost struct {
	ID                  uuid.UUID  `json:"id"`
	TenantID            uuid.UUID  `json:"tenant_id"`
	LimitKey            string     `json:"limit_key"`
	Delta               int        `json:"delta"`
	ValidUntil          time.Time  `json:"valid_until"`
	SourceInvoiceLineID *uuid.UUID `json:"source_invoice_line_id"`
	CreatedAt           time.Time  `json:"created_at"`
}
```

- Produces (interface.go additions for THIS task):

```go
// Billing — profiles & catalog (spec 2026-08-25-billing-invoices-design.md)
UpsertTenantBillingProfile(ctx context.Context, p *models.TenantBillingProfile) error
// GetTenantBillingProfile returns (nil, nil) when the tenant has no profile.
GetTenantBillingProfile(ctx context.Context, tenantID uuid.UUID) (*models.TenantBillingProfile, error)
CreateCatalogItem(ctx context.Context, item *models.BillingCatalogItem) error
UpdateCatalogItem(ctx context.Context, item *models.BillingCatalogItem) error
// GetCatalogItems: publicOnly=true → is_public AND is_active only (tenant view).
GetCatalogItems(ctx context.Context, publicOnly bool) ([]*models.BillingCatalogItem, error)
// GetCatalogItemByID returns (nil, nil) when absent.
GetCatalogItemByID(ctx context.Context, id uuid.UUID) (*models.BillingCatalogItem, error)
```

- [ ] **Step 1: Write failing integration tests** in `pg_store_billing_integration_test.go`. Follow the existing integration-test setup in `pg_store_equipment_integration_test.go` / `pg_store_tenant_scoped_stats_integration_test.go` (skip without `TEST_DATABASE_URL`, migrate, per-test tenant fixture). Tests:
  - `TestBillingProfileUpsertRoundTrip` — upsert (insert), Get returns fields; upsert again with changed `LegalName` updates, `UpdatedAt` advances; Get for a tenant without profile → `(nil, nil)`.
  - `TestCatalogItemCRUDAndFiltering` — create one item per kind (plan item references a seeded plan's ID via `GetSubscriptionPlans`); `GetCatalogItems(false)` returns all 3 ordered by `sort_order, name`; set one `is_public=false`/`is_active=false` and assert `GetCatalogItems(true)` filters both out; `UpdateCatalogItem` changes price and Get reflects it; `GetCatalogItemByID` on random UUID → `(nil, nil)`.
  - `TestCatalogKindChecksRejectInconsistentRows` — `CreateCatalogItem` with `kind="service"` but non-nil `PlanID` returns an error (DB CHECK fires).
- [ ] **Step 2: Run → FAIL** (methods undefined).
- [ ] **Step 3: Implement.** Append models to `models.go`; add interface methods; implement in new `pg_store_billing.go` with plain pgx SQL (`INSERT ... ON CONFLICT (tenant_id) DO UPDATE` for profile; explicit column lists; scan `NUMERIC` via `float64`). List ordering: `ORDER BY sort_order, name`.
- [ ] **Step 4: Run store tests → PASS**: `cd backend && TEST_DATABASE_URL=... go test -count=1 ./internal/store/`.
- [ ] **Step 5: Full gate** — `go build ./... && go test -count=1 ./... && golangci-lint run ./internal/...`.
- [ ] **Step 6: Commit** — `feat(billing): store layer for billing profiles and catalog items`

---

### Task 3: Store — invoice issue (numbering, snapshots), get, list

**Files:**
- Modify: `backend/internal/store/interface.go`, `backend/internal/store/pg_store_billing.go`
- Test: append to `backend/internal/store/pg_store_billing_integration_test.go`

**Interfaces:**
- Consumes: Task 2 models.
- Produces:

```go
// InvoiceFilter narrows ListInvoices. Zero value = all invoices.
type InvoiceFilter struct {
	TenantID *uuid.UUID
	Status   string // "", "issued", "paid", "cancelled"
	Limit    int    // 0 → 100
	Offset   int
}

// CreateInvoice assigns inv.Number (СЧ-<year>-<NNNN>, per-year counter),
// inserts the invoice and its lines atomically, and fills inv.ID/IssuedAt.
// Lines must arrive with Position/snapshot fields/Quantity/Amount set.
CreateInvoice(ctx context.Context, inv *models.Invoice, lines []*models.InvoiceLine) error
// GetInvoiceByID returns the invoice with Lines loaded, (nil, nil) when absent.
GetInvoiceByID(ctx context.Context, id uuid.UUID) (*models.Invoice, error)
// ListInvoices returns invoices (no lines) newest-first with TenantName joined.
ListInvoices(ctx context.Context, f InvoiceFilter) ([]*models.Invoice, error)
```

- [ ] **Step 1: Failing tests:**
  - `TestCreateInvoiceAssignsSequentialNumbers` — create two invoices for the fixture tenant in the same year; numbers are `СЧ-<year>-000N` and `СЧ-<year>-000N+1` (parse the year from `IssuedAt`; do not hardcode 2026); a pre-seeded `invoice_counters` row for year 2001 with `last_value=41` plus a direct SQL exercise of the counter UPSERT yields 42 (pin the increment semantics).
  - `TestGetInvoiceByIDLoadsLinesInOrder` — invoice with 3 lines (positions 1..3, one per kind, snapshot fields populated incl. `VATRate` on one line); Get returns lines ordered by position with all snapshot fields intact; random UUID → `(nil, nil)`.
  - `TestListInvoicesFilters` — two tenants, three invoices; filter by TenantID returns only theirs newest-first with `TenantName` set; Status filter works; no filter returns all.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `CreateInvoice` opens `s.db.Begin(ctx)` (inside a handler's `WithTx` this becomes a savepoint — established `txConn` behavior):

```go
year := time.Now().Year()
var n int
err = tx.QueryRow(ctx, `INSERT INTO invoice_counters (year, last_value) VALUES ($1, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = invoice_counters.last_value + 1
    RETURNING last_value`, year).Scan(&n)
// ...
inv.Number = fmt.Sprintf("СЧ-%d-%04d", year, n)
```

then INSERT invoice RETURNING id/issued_at/created_at/updated_at, INSERT each line, commit. `ListInvoices`: `LEFT JOIN tenants t ON t.id = i.tenant_id`, `ORDER BY i.issued_at DESC`, default limit 100.
- [ ] **Step 4: Run store tests → PASS.**
- [ ] **Step 5: Full backend gate.**
- [ ] **Step 6: Commit** — `feat(billing): invoice issue with per-year numbering, get/list`

---

### Task 4: Store — mark-paid application semantics, cancel, boosts, effective limits

**Files:**
- Modify: `backend/internal/store/interface.go`, `pg_store_billing.go`, and `resolveTenantLimit` in `backend/internal/store/pg_store.go` (~line 2507)
- Test: append to `pg_store_billing_integration_test.go`

**Interfaces:**
- Produces:

```go
// Sentinel errors for mark-paid/cancel guards (handlers map them to 409).
var (
	ErrInvoiceNotFound     = errors.New("invoice not found")
	ErrInvoiceNotIssued    = errors.New("invoice is not in issued status")
	ErrBoostNeedsEndDate   = errors.New("addon is until_period_end but subscription has no end_date")
)

// AppliedLineEffect describes what one paid line did (for the audit row and
// the operator confirmation response).
type AppliedLineEffect struct {
	LineID uuid.UUID `json:"line_id"`
	Kind   string    `json:"kind"`
	Effect string    `json:"effect"` // human-readable machine summary, e.g. "plan pro extended to 2026-10-01", "boost attendees_per_event +1000 until 2026-09-12", "service (no effect)", "manual (operator applies)"
}

// ApplyInvoicePayment marks invoice paid (issued→paid guard) and applies
// every line per the spec's Application semantics. Runs in ONE transaction.
ApplyInvoicePayment(ctx context.Context, invoiceID uuid.UUID, now time.Time) (*models.Invoice, []AppliedLineEffect, error)
// CancelInvoice: issued→cancelled guard, sets cancelled_at.
CancelInvoice(ctx context.Context, invoiceID uuid.UUID) error
// GetActiveLimitBoosts returns boosts with valid_until > now, newest first.
GetActiveLimitBoosts(ctx context.Context, tenantID uuid.UUID) ([]*models.LimitBoost, error)
```

**Application semantics (verbatim from spec — implement exactly):**
- `service` — no effect.
- `plan`/`on_payment` — subscription upsert: `plan_id`=line plan, `status='active'`, `start_date` kept (or `now` if new), `end_date = now + period×quantity` (month → `AddDate(0,1,0)` per unit, year → `AddDate(1,0,0)` per unit).
- `plan`/`after_current` — base = `max(now, current end_date)` (nil end_date or no subscription → `now`); `end_date = base + period×quantity`; `plan_id` = line plan; `status='active'` (revives expired).
- `plan`/`manual` — no automatic effect; effect text "manual (operator applies)".
- `addon` — resolve `valid_until`: `until_period_end` → current subscription `end_date` (nil sub or nil end_date → return `ErrBoostNeedsEndDate`, whole tx rolls back); `fixed_days` → `now + validity_days×24h`. Insert `limit_boosts` row with `delta = limit_delta × quantity`, `source_invoice_line_id` = line ID.
- If the tenant has NO subscription row and a plan line applies, create one via `UpsertSubscription` semantics (INSERT with tenant_id, status active, start_date now).

- [ ] **Step 1: Failing tests** (each creates its own tenant + invoice fixtures through Task 2/3 methods):
  - `TestApplyInvoicePaymentOnPaymentUpgrade` — tenant subscribed to free plan; invoice line plan=pro/`on_payment`/month/qty=1 → after apply: subscription plan=pro, status active, end_date ≈ now+1mo; invoice paid with PaidAt set; effect recorded.
  - `TestApplyInvoicePaymentAfterCurrentChains` — subscription active, end_date = now+10d; line plan=same/`after_current`/month/qty=2 → end_date ≈ (now+10d)+2mo. Second sub-case: subscription expired with end_date in the past → base=now, status back to active.
  - `TestApplyInvoicePaymentAddonAndManual` — line addon attendees_per_event +500 qty=2 `fixed_days` 30 → boost row delta=1000, valid_until ≈ now+30d; a manual plan line and a service line produce no subscription change; effects list has 3 entries with correct kinds.
  - `TestApplyInvoicePaymentAddonUntilPeriodEndRequiresEndDate` — subscription with NULL end_date + addon `until_period_end` → `ErrBoostNeedsEndDate`, invoice STILL issued (rollback), no boost row.
  - `TestApplyInvoicePaymentGuardsStatus` — applying twice → second returns `ErrInvoiceNotIssued`; cancel after paid → `ErrInvoiceNotIssued`; `CancelInvoice` on issued → status cancelled, cancelled_at set.
  - `TestResolveTenantLimitAddsActiveBoosts` — plan limit users=3; insert boost users +2 valid 1h → `CheckTenantLimit(users)` max=5; expired boost (valid_until in past) NOT counted; custom_limits=-1 (unlimited) ignores boosts entirely.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `ApplyInvoicePayment`: `tx, err := s.db.Begin(ctx)`; `SELECT ... FROM invoices WHERE id=$1 FOR UPDATE`; guard status; load lines ordered; load subscription (`SELECT ... FOR UPDATE` via existing query shape); apply per line; `UPDATE invoices SET status='paid', paid_at=$2, updated_at=NOW()`; commit; return invoice via `GetInvoiceByID`. `resolveTenantLimit` change — after the existing custom/plan resolution, before returning:

```go
if maxLimit != -1 {
	var boost float64
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(delta), 0) FROM limit_boosts
		 WHERE tenant_id = $1 AND limit_key = $2 AND valid_until > NOW()`,
		tenantID, limitType).Scan(&boost); err != nil {
		return 0, err
	}
	maxLimit += boost
}
```

- [ ] **Step 4: Run store tests → PASS** (including pre-existing limit tests — the boost query must not break them).
- [ ] **Step 5: Full backend gate.**
- [ ] **Step 6: Commit** — `feat(billing): mark-paid application semantics, limit boosts in effective limits`

---

### Task 5: Subscription lifecycle ticker

**Files:**
- Modify: `backend/internal/store/interface.go`, `pg_store_billing.go`; `backend/internal/config/config.go`; `backend/main.go`
- Create: `backend/internal/billing/lifecycle.go`
- Test: `backend/internal/billing/lifecycle_test.go`, `backend/internal/store/pg_store_lifecycle_integration_test.go`, append to `backend/internal/config/config_test.go`

**Interfaces:**
- Produces: `ExpireOverdueSubscriptions(ctx context.Context) (int, error)` on `store.Store`; `billing.StartLifecycle(s LifecycleStore, interval time.Duration, initialDelay time.Duration) bool`; `Config.SubscriptionLifecycleInterval time.Duration` from env `SUBSCRIPTION_LIFECYCLE_INTERVAL` (Go duration string; empty → `1h`; `"0"` → disabled; invalid → startup error).

- [ ] **Step 1: Failing store integration test** `TestExpireOverdueSubscriptions`: three tenants — (a) trial with `trial_end_date` yesterday, (b) active with `end_date` yesterday, (c) active with `end_date` tomorrow. Run method → returns 2; (a) and (b) now `expired`, (c) untouched; `admin_audit_log` gained 2 rows with `action='subscription_expired'`, `admin_user_id IS NULL`, `target_type='tenant'`, correct `target_id`. Second run → returns 0 (idempotent).
- [ ] **Step 2: Failing unit test** in `lifecycle_test.go` (mirror `retention_test.go`): fake store counting calls; `StartLifecycle(s, 0, 0)` returns false and never calls; `RunLifecycleOnce` calls the method and logs errors without panicking.
- [ ] **Step 3: Run both → FAIL.**
- [ ] **Step 4: Implement.** Store method — single statement, audit rows written in the same SQL (NULL actor; do NOT use LogAdminAction):

```sql
WITH expired AS (
    UPDATE subscriptions
       SET status = 'expired', updated_at = NOW()
     WHERE (status = 'trial'  AND trial_end_date IS NOT NULL AND trial_end_date < NOW())
        OR (status = 'active' AND end_date       IS NOT NULL AND end_date       < NOW())
    RETURNING id, tenant_id, plan_id
)
INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, changes)
SELECT NULL, 'subscription_expired', 'tenant', tenant_id,
       jsonb_build_object('subscription_id', id, 'plan_id', plan_id, 'new_status', 'expired')
  FROM expired
```

(return `CommandTag.RowsAffected()` of the INSERT as the count). `lifecycle.go` mirrors `retention.go` exactly (own narrow `LifecycleStore` interface, goroutine + ticker + `RunLifecycleOnce`). Config parsing:

```go
switch raw := os.Getenv("SUBSCRIPTION_LIFECYCLE_INTERVAL"); raw {
case "":
	cfg.SubscriptionLifecycleInterval = time.Hour
case "0":
	cfg.SubscriptionLifecycleInterval = 0
default:
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return nil, fmt.Errorf("SUBSCRIPTION_LIFECYCLE_INTERVAL must be a Go duration (e.g. 1h) or 0 to disable, got %q", raw)
	}
	cfg.SubscriptionLifecycleInterval = d
}
```

`main.go`, next to `retention.Start` (SaaS only, spec: on-prem installs are not metered):

```go
if cfg.DeploymentMode == config.ModeSaaS {
	billing.StartLifecycle(pgStore, cfg.SubscriptionLifecycleInterval, time.Minute)
}
```

- [ ] **Step 5: Run all → PASS; full backend gate.**
- [ ] **Step 6: Commit** — `feat(billing): subscription lifecycle ticker (trial/active → expired)`

---

### Task 6: Seller requisites config + «сумма прописью»

**Files:**
- Modify: `backend/internal/config/config.go` (+ `config_test.go`)
- Create: `backend/internal/billing/amountwords.go`, `backend/internal/billing/amountwords_test.go`

**Interfaces:**
- Produces:

```go
// config.Config additions:
BillingSellerName            string // BILLING_SELLER_NAME
BillingSellerINN             string // BILLING_SELLER_INN
BillingSellerBankName        string // BILLING_SELLER_BANK_NAME
BillingSellerBankAccount     string // BILLING_SELLER_BANK_ACCOUNT (р/с)
BillingSellerBankBIK         string // BILLING_SELLER_BANK_BIK
BillingSellerBankCorrAccount string // BILLING_SELLER_BANK_CORR_ACCOUNT (к/с, optional)

// BillingSellerConfigured reports whether all required seller requisites are
// set (corr account optional). Package-level accessor Seller() also needed:
func (c *Config) BillingSellerConfigured() bool
// Seller returns the loaded config's seller block for handlers; nil-safe
// (falls back to env reads before Load, mirroring JWTSecret()).
func Seller() SellerRequisites  // struct with the six fields + Configured bool

// billing.AmountInWords renders a ruble amount per RF invoice convention:
// AmountInWords(1234.56) == "Одна тысяча двести тридцать четыре рубля 56 копеек"
// AmountInWords(1) == "Один рубль 00 копеек"; AmountInWords(0) == "Ноль рублей 00 копеек"
func AmountInWords(amount float64) string
```

- [ ] **Step 1: Failing tests.** Config: all-set → `BillingSellerConfigured()==true`; missing BIK → false; `Load` does NOT fail when seller vars are absent (billing simply unconfigured). Amount-in-words table test:

```go
cases := map[float64]string{
	0:          "Ноль рублей 00 копеек",
	1:          "Один рубль 00 копеек",
	2:          "Два рубля 00 копеек",
	5:          "Пять рублей 00 копеек",
	11:         "Одиннадцать рублей 00 копеек",
	21:         "Двадцать один рубль 00 копеек",
	100:        "Сто рублей 00 копеек",
	1234.56:    "Одна тысяча двести тридцать четыре рубля 56 копеек",
	2990:       "Две тысячи девятьсот девяносто рублей 00 копеек",
	9990:       "Девять тысяч девятьсот девяносто рублей 00 копеек",
	99900:      "Девяносто девять тысяч девятьсот рублей 00 копеек",
	1000000:    "Один миллион рублей 00 копеек",
	2500000.05: "Два миллиона пятьсот тысяч рублей 05 копеек",
	321:        "Триста двадцать один рубль 00 копеек",
	1011:       "Одна тысяча одиннадцать рублей 00 копеек",
}
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `amountwords.go`** (complete — transcribe):

```go
// Package billing: subscription lifecycle + RF invoice helpers.
package billing

import (
	"fmt"
	"math"
	"strings"
)

var (
	awUnitsM = []string{"", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"}
	awUnitsF = []string{"", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"}
	awTeens  = []string{"десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
		"пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"}
	awTens = []string{"", "", "двадцать", "тридцать", "сорок", "пятьдесят",
		"шестьдесят", "семьдесят", "восемьдесят", "девяносто"}
	awHundreds = []string{"", "сто", "двести", "триста", "четыреста", "пятьсот",
		"шестьсот", "семьсот", "восемьсот", "девятьсот"}
)

// awPlural picks the Russian plural form for n: (1 рубль, 2 рубля, 5 рублей).
func awPlural(n int64, one, few, many string) string {
	n = n % 100
	if n >= 11 && n <= 19 {
		return many
	}
	switch n % 10 {
	case 1:
		return one
	case 2, 3, 4:
		return few
	default:
		return many
	}
}

// awTriple renders 0..999; feminine toggles «одна/две» (for тысячи).
func awTriple(n int64, feminine bool) string {
	units := awUnitsM
	if feminine {
		units = awUnitsF
	}
	var parts []string
	if h := n / 100; h > 0 {
		parts = append(parts, awHundreds[h])
	}
	rest := n % 100
	switch {
	case rest >= 10 && rest <= 19:
		parts = append(parts, awTeens[rest-10])
	default:
		if t := rest / 10; t >= 2 {
			parts = append(parts, awTens[t])
		}
		if u := rest % 10; u > 0 {
			parts = append(parts, units[u])
		}
	}
	return strings.Join(parts, " ")
}

// AmountInWords renders a ruble amount for the invoice's «сумма прописью»
// line: capitalized words for rubles, two digits for kopecks.
// Supports amounts below a billion rubles (invoice totals).
func AmountInWords(amount float64) string {
	kop := int64(math.Round(amount * 100))
	rub := kop / 100
	kop = kop % 100

	var words []string
	if m := rub / 1_000_000 % 1000; m > 0 {
		words = append(words, awTriple(m, false), awPlural(m, "миллион", "миллиона", "миллионов"))
	}
	if t := rub / 1000 % 1000; t > 0 {
		words = append(words, awTriple(t, true), awPlural(t, "тысяча", "тысячи", "тысяч"))
	}
	if u := rub % 1000; u > 0 {
		words = append(words, awTriple(u, false))
	}
	if len(words) == 0 {
		words = append(words, "ноль")
	}
	sentence := strings.Join(words, " ")
	runes := []rune(sentence)
	runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
	return fmt.Sprintf("%s %s %02d %s",
		string(runes),
		awPlural(rub, "рубль", "рубля", "рублей"),
		kop,
		awPlural(kop, "копейка", "копейки", "копеек"))
}
```

Note the kopeck plural: `05 копеек` (5→many), `56 копеек` — matches the test table. Config: add fields, env reads in `Load`, `BillingSellerConfigured`, and a package-level `Seller()` accessor mirroring `JWTSecret()` (returns a `SellerRequisites` struct: `Name, INN, BankName, BankAccount, BankBIK, BankCorrAccount string; Configured bool`).
- [ ] **Step 4: Run → PASS; full backend gate.**
- [ ] **Step 5: Commit** — `feat(billing): seller requisites config + amount-in-words helper`

---

### Task 7: Tenant-facing handlers + routes

**Files:**
- Create: `backend/internal/handler/billing_tenant.go`
- Modify: `backend/internal/handler/handler.go`
- Test: `backend/internal/handler/billing_tenant_test.go`

**Interfaces:**
- Consumes: store methods (Tasks 2–4), `config.Seller()`, `billing.AmountInWords`, `claimsFromContext`/`tenantIDFromContext`/`writeErr` (authz.go), `fakeStore` (testsupport_test.go — embedded interface, add func fields for the billing methods used).
- Produces routes (inside `RegisterRoutes`, in the `api` group, wrapped in `if mode == config.ModeSaaS { ... }` — billing is a SaaS surface):

```go
// Billing (tenant self-service) — SaaS-only, admin-role-only inside handlers
api.GET("/billing/profile", h.GetBillingProfile)
api.PUT("/billing/profile", h.PutBillingProfile)
api.GET("/billing/catalog", h.GetBillingCatalog)
api.GET("/billing/invoices", h.GetTenantInvoices)
api.POST("/billing/invoices", h.CreateTenantInvoice)
api.GET("/billing/invoices/:id", h.GetTenantInvoice)
```

**Handler contracts (implement exactly):**
- Every handler starts with a shared guard `requireTenantAdminForBilling(c)`: claims → `claims.Role != "admin"` → 403 `{"error": "Billing requires the admin role"}`; returns tenantID.
- `GetBillingProfile` — 200 profile; no profile → 404 `{"error": "Billing profile is not set"}`.
- `PutBillingProfile` — body `{legal_name, inn, kpp?, legal_address}`; validation: legal_name and legal_address non-blank after TrimSpace; inn is 10 or 12 digits (`regexp.MustCompile(`^\d{10}$|^\d{12}$`)`); kpp when present is 9 digits; violations → 400 with a specific message (`"inn must be 10 or 12 digits"`, etc.). Upsert; 200 profile.
- `GetBillingCatalog` — `GetCatalogItems(publicOnly=true)`; 200 array.
- `CreateTenantInvoice` — body `{lines: [{catalog_item_id: uuid, quantity: int}], comment?: string}`. Guards in order: lines non-empty and every quantity ≥ 1 (400); seller `!Configured` → 409 `{"error": "Seller requisites are not configured"}`; profile nil → 409 `{"error": "Billing profile is required before requesting an invoice"}`; each catalog item must exist AND `IsActive` AND `IsPublic` (else 400 `{"error": "Unknown or unavailable catalog item"}`). Build snapshot lines (Position = 1-based input order; copy kind/name/price/vat_rate/plan fields/addon fields; `Activation` = item `DefaultActivation`; `Amount = Price × Quantity` rounded to 2 decimals via `math.Round(x*100)/100`); `Total` = sum of amounts. Fill buyer snapshot from profile, seller snapshot from `config.Seller()`, `CreatedBy` = caller ID. `CreateInvoice`; 201 with invoice (Lines + `TotalInWords`).
- `GetTenantInvoices` — `ListInvoices({TenantID: &tenantID})`; 200 array.
- `GetTenantInvoice` — Get; nil or `inv.TenantID != tenantID` → 404 (no existence oracle); else set `inv.TotalInWords = billing.AmountInWords(inv.Total)`; 200.

- [ ] **Step 1: Failing handler tests** (echo + `fakeStore` with func-field overrides; JWT claims injected via `c.Set("user", &models.JWTCustomClaims{...})` — copy the arrangement from an existing handler test such as `users_test.go`):
  - non-admin role → 403 on every endpoint (table-driven).
  - `PutBillingProfile` rejects bad INN (11 digits) with 400; accepts 10-digit, calls upsert.
  - `CreateTenantInvoice`: unconfigured seller → 409; no profile → 409; inactive item → 400; happy path: fake returns catalog items, assert the `CreateInvoice` call received correct snapshot (activation copied, amount = price×qty, total summed, buyer/seller snapshots filled) and response is 201 with `total_in_words` non-empty.
  - `GetTenantInvoice` for another tenant's invoice → 404.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement + wire routes.** Move the existing super-admin `if mode == config.ModeSaaS` block or add a second one — keep tenant billing registration right before the super-admin block with a comment `// Billing (bank-transfer invoicing) — SaaS-only surface, spec 2026-08-25`.
- [ ] **Step 4: Run handler tests → PASS; full backend gate.**
- [ ] **Step 5: Commit** — `feat(billing): tenant-facing billing endpoints (profile, catalog, invoices)`

---

### Task 8: OpenAPI paths + panel client regen

**Files:**
- Modify: `backend/openapi.yaml`
- Regenerate: `panel/src/shared/api/schema.d.ts` (`npm run generate:api -w panel`)

**Interfaces:**
- Produces: openapi-typescript types `components["schemas"]["BillingProfile" | "BillingCatalogItem" | "Invoice" | "InvoiceLine"]` and the six `/api/billing/*` paths — Task 13's hooks depend on these exact operationIds: `getBillingProfile`, `putBillingProfile`, `getBillingCatalog`, `listTenantInvoices`, `createTenantInvoice`, `getTenantInvoice`.

- [ ] **Step 1: Add schemas** under `components.schemas` (mirror the Go JSON tags exactly; nullable fields as `nullable: true`). `BillingCatalogItem`: all kind-specific fields nullable; `kind`/`period`/`default_activation`/`limit_key`/`validity` as string enums matching Global Constraints. `Invoice` includes `lines` (array of `InvoiceLine`), `total_in_words`, `tenant_name` (both optional). `InvoiceLine` mirrors the model. `BillingProfile` = tenant_billing_profile JSON.
- [ ] **Step 2: Add paths** following the existing house style (operationId, `security: [{ bearerAuth: [] }]`, every error status with `$ref: Error`): `/api/billing/profile` GET (200/403/404), PUT (200/400/403); `/api/billing/catalog` GET (200/403); `/api/billing/invoices` GET (200/403), POST (201/400/403/409) with request schema `{lines: [{catalog_item_id: uuid, quantity: integer minimum 1}], comment?: string}`; `/api/billing/invoices/{id}` GET (200/400/403/404).
- [ ] **Step 3: Regen + verify:** `npm run generate:api -w panel`, then `npm run typecheck -w panel` (must stay green), and `git diff --stat` must show `schema.d.ts` changed.
- [ ] **Step 4: Backend contract sanity:** `cd backend && go test -count=1 ./internal/handler/ -run OpenAPI` — existing contract suites must still pass (they validate the yaml parses).
- [ ] **Step 5: Commit (single commit — yaml + regenerated client together)** — `feat(billing): openapi spec for tenant billing + regenerated panel client`

---

### Task 9: Super-admin handlers + routes + boost visibility

**Files:**
- Create: `backend/internal/handler/billing_super.go`
- Modify: `backend/internal/handler/handler.go`, `backend/internal/handler/super_admin.go` (GetTenantStats response)
- Test: `backend/internal/handler/billing_super_test.go`

**Interfaces:**
- Consumes: store billing methods, `WithTx`/`txFail`/`respondTxError` (super_admin.go), `LogAdminAction`, `billing.AmountInWords`.
- Produces routes (inside the existing `superAdmin` group):

```go
// Billing
superAdmin.GET("/billing/catalog", h.GetCatalogSuper)          // ?include_inactive=true
superAdmin.POST("/billing/catalog", h.CreateCatalogItemSuper)
superAdmin.PUT("/billing/catalog/:id", h.UpdateCatalogItemSuper)
superAdmin.GET("/billing/invoices", h.ListInvoicesSuper)       // ?tenant_id=&status=
superAdmin.POST("/billing/invoices", h.CreateInvoiceSuper)
superAdmin.GET("/billing/invoices/:id", h.GetInvoiceSuper)
superAdmin.POST("/billing/invoices/:id/mark-paid", h.MarkInvoicePaidSuper)
superAdmin.POST("/billing/invoices/:id/cancel", h.CancelInvoiceSuper)
```

**Handler contracts:**
- Catalog create/update: bind `models.BillingCatalogItem`; validate kind-consistency BEFORE the DB (mirror the CHECKs; 400 with a field-specific message, e.g. `"plan items require plan_id, period and default_activation"`); price ≥ 0; name non-blank. Both wrapped in `WithTx` + `LogAdminAction("create_catalog_item"|"update_catalog_item", "billing_catalog_item", item.ID, {"item"| "old"/"new": ...})` — update loads the old item first for the audit diff.
- `GetCatalogSuper`: `GetCatalogItems(false)`; when `include_inactive` != "true", filter `IsActive` in the handler.
- `CreateInvoiceSuper`: body `{tenant_id, lines: [{catalog_item_id, quantity}], comment?}`. Same construction as the tenant flow EXCEPT: items need only exist and be `IsActive` (public not required); buyer profile still required (409 if the TENANT has no billing profile); wrapped in `WithTx` with `LogAdminAction("create_invoice", "invoice", inv.ID, {"number": ..., "tenant_id": ..., "total": ...})`. 201 with invoice.
- `ListInvoicesSuper`: parse optional `tenant_id` (400 on bad uuid) and `status` (400 unless in {issued,paid,cancelled}); 200 array.
- `GetInvoiceSuper`: 404 when nil; sets `TotalInWords`; 200.
- `MarkInvoicePaidSuper`: body `{reason}` optional. `WithTx`: `tx.ApplyInvoicePayment(ctx, id, time.Now())`; map `ErrInvoiceNotFound` → txFail 404, `ErrInvoiceNotIssued` → txFail 409 `"invoice is not payable in its current status"`, `ErrBoostNeedsEndDate` → txFail 409 `"addon requires the subscription to have an end date — fix the subscription or use a fixed-days addon"`; then `LogAdminAction("invoice_paid", "invoice", id, {"number": inv.Number, "tenant_id": inv.TenantID, "effects": effects, "reason": reason})`. Response 200 `{"invoice": inv, "effects": effects}`.
- `CancelInvoiceSuper`: `WithTx`: `CancelInvoice` (map sentinels 404/409) + `LogAdminAction("invoice_cancelled", ...)`; 200 `{"status": "cancelled"}`.
- `GetTenantStats` (super_admin.go): after loading stats, call `h.Store.GetActiveLimitBoosts(ctx, tenantID)` and return the response with an added `active_boosts` field. Current response is `c.JSON(http.StatusOK, stats)` — wrap: `return c.JSON(http.StatusOK, map[string]interface{}{...})`? NO — inspect the actual `stats` type first; if it is a struct, add an `ActiveBoosts []*models.LimitBoost \`json:"active_boosts,omitempty"\`` field to that struct (models.go) and set it in the handler. Keep the response shape otherwise identical (console depends on it).

- [ ] **Step 1: Failing tests:** kind-validation 400s (service item with plan_id; addon without limit_key; fixed_days without validity_days); mark-paid maps `ErrInvoiceNotIssued` → 409 and `ErrBoostNeedsEndDate` → 409 with the exact messages; mark-paid happy path returns effects and logs `invoice_paid` (fake WithTx executes the closure against the fake — copy the pattern from `super_admin_lifecycle_test.go`); cancel guard; `GetTenantStats` response includes `active_boosts` when the fake returns one.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement + wire routes.**
- [ ] **Step 4: Run → PASS; full backend gate** (`go build ./... && go test -count=1 ./... && golangci-lint run ./internal/...`).
- [ ] **Step 5: Commit** — `feat(billing): super-admin billing endpoints (catalog, invoices, mark-paid)`

---

### Task 10: Console — «Каталог» page

**Files:**
- Create: `web/src/pages/super-admin/BillingCatalog.tsx`, `web/src/lib/vat.ts`, `web/src/lib/__tests__/vat.test.ts`
- Modify: `web/src/App.tsx` (route `billing/catalog`), `web/src/pages/super-admin/SuperAdminLayout.tsx` (nav item), `web/src/i18n.ts` (en + ru blocks)
- Test: `web/src/pages/super-admin/__tests__/BillingCatalog.test.tsx`

**Interfaces:**
- Consumes: `GET/POST/PUT /api/super-admin/billing/catalog` (Task 9), `api` from `@/lib/api`, ui primitives from `@/components/ui/*`, `useTranslation`.
- Produces: `includedVat(amount: number, rate: number): number` in `vat.ts` — `Math.round((amount * rate / (100 + rate)) * 100) / 100` (Task 11 reuses it); i18n keys listed below (Tasks 11–12 reuse the shared ones).

**Page spec** (follow `SubscriptionPlans.tsx` structurally — axios + useState/useEffect + `loadItems()` refetch after mutations, sonner toasts, inline `animate-pulse` loading):
- Table (ui `Table*`): columns Название / Тип (Badge: `billingKindPlan|Service|Addon` label) / Цена (`toLocaleString('ru-RU')` + ` ₽`) / НДС («Без НДС» or `в т.ч. НДС X%`) / Видимость (public/active badges) / actions (Изменить).
- «Добавить позицию» button → Dialog with kind-aware form (plain useState): common fields name, description, price, vat_rate (Select: Без НДС / 5% / 7% / 10% / 20% — value "" maps to null), is_public + is_active (Switch), sort_order; kind Select switches extra fields — plan: plan Select (loaded from `/api/super-admin/plans`), period Select (Месяц/Год), default_activation Select (После оплаты/После завершения текущей/Вручную); addon: limit_key Select (Посетители на мероприятие/Мероприятий в месяц/Пользователи), limit_delta number, validity Select (До конца подписки/На срок), validity_days number shown only for fixed_days. Client-side validation mirrors the backend 400s; submit POST or PUT, toast, `loadItems()`.
- i18n keys (add to BOTH blocks; ru values shown — en implementer writes natural English): `billingCatalog` «Каталог», `billingCatalogAddItem` «Добавить позицию», `billingKindPlan` «Тариф», `billingKindService` «Услуга», `billingKindAddon` «Надбавка», `billingNoVat` «Без НДС», `billingVatIncluded` «в т.ч. НДС {{rate}}%», `billingPeriodMonth` «Месяц», `billingPeriodYear` «Год», `billingActivationOnPayment` «После оплаты», `billingActivationAfterCurrent` «После завершения текущей», `billingActivationManual` «Вручную», `billingLimitAttendees` «Посетители на мероприятие», `billingLimitEvents` «Мероприятий в месяц», `billingLimitUsers` «Пользователи», `billingValidityUntilPeriodEnd` «До конца подписки», `billingValidityFixedDays` «На срок (дней)», `billingItemSaved` «Позиция сохранена», `billingPublicBadge` «Публичная», `billingInactiveBadge` «Неактивна».
- Nav: add to `menuItems` `{ icon: <ShoppingCart .../>, label: t('billingCatalog'), path: '/billing/catalog' }` after Plans; route in App.tsx `<Route path="billing/catalog" element={<BillingCatalog />} />`.

- [ ] **Step 1: Failing tests.** `vat.test.ts`: `includedVat(120, 20) === 20`, `includedVat(100, 20) === 16.67`. Page test (vi.mock `@/lib/api`, real i18n import): renders 3 mocked items with kind badges and «Без НДС»; opening the dialog and picking kind=addon shows the limit fields; submit calls `api.post` with the right body (vat_rate null when «Без НДС»).
- [ ] **Step 2: Run → FAIL** (`npx vitest run src/pages/super-admin/__tests__/BillingCatalog.test.tsx src/lib/__tests__/vat.test.ts` in web/).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Web full gate** (fresh deps first — standalone lockfile): `cd web && npm ci && npm test && npx tsc -b && npx eslint . && npm run build`.
- [ ] **Step 5: Commit** — `feat(console): billing catalog page`

---

### Task 11: Console — «Счета» page + print view

**Files:**
- Create: `web/src/pages/super-admin/BillingInvoices.tsx`, `web/src/pages/super-admin/InvoicePrint.tsx`
- Modify: `web/src/App.tsx` (routes `billing/invoices`, `billing/invoices/:id/print`), `SuperAdminLayout.tsx` (nav «Счета»), `web/src/i18n.ts`
- Test: `web/src/pages/super-admin/__tests__/BillingInvoices.test.tsx`, `__tests__/InvoicePrint.test.tsx`

**Interfaces:**
- Consumes: Task 9 endpoints; `TenantCombobox` (`web/src/components/TenantCombobox.tsx`), `ConfirmActionDialog`, `includedVat` from `@/lib/vat`.

**BillingInvoices spec:**
- Status filter (Select: Все/Выставлен/Оплачен/Отменён → `?status=`), table: Номер / Организация (`tenant_name`) / Дата (`toLocaleDateString('ru-RU')`) / Сумма / Статус (Badge variant per status) / actions.
- Row actions: «Открыть» (print view link `/billing/invoices/:id/print`), and for `issued` only: «Отметить оплаченным», «Отменить».
- Mark-paid: fetch invoice detail first, ConfirmActionDialog listing what will be applied per line (kind label + name + qty; for plan lines the activation-mode label; for addons «+delta limit до/на срок»), then `POST .../mark-paid`; on 409 show the server `error` text in the toast; success toast shows `effects.length` applied.
- Cancel: ConfirmActionDialog with required reason textarea → `POST .../cancel`.
- «Выставить счёт» Dialog: TenantCombobox; catalog items (from `/api/super-admin/billing/catalog`) each with a quantity stepper (0 = not included); running total; comment textarea; POST; toast with the returned `number`.

**InvoicePrint spec (RF «Счёт на оплату» layout — same layout contract as the panel print page in Task 13):**
- Route renders WITHOUT SuperAdminLayout chrome (register outside the layout `<Route>`; still behind `ProtectedRoute requireSuperAdmin`).
- Structure, top to bottom: bank-requisites table (Банк получателя + БИК/к‑с left, ИНН/КПП + Получатель + р/с right — the classic two-column счёт header grid); `<h1>Счёт на оплату № {number} от {date «25 августа 2026 г.» via toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric'})}</h1>`; Поставщик (Исполнитель): name, ИНН, address line; Покупатель (Заказчик): buyer_name, ИНН/КПП, address; lines table `№ | Наименование | Кол-во | Цена | Сумма`; totals block right-aligned: Итого; then either «Без НДС» (when no line has vat_rate) or «В том числе НДС: X ₽» (sum of `includedVat(line.amount, line.vat_rate)` over VAT lines); «Всего к оплате»; `Всего наименований {lines.length}, на сумму {total} ₽`; bold `{total_in_words}` (from API); footer «Оплата данного счёта означает согласие с условиями поставки услуг.» + a signature line «Руководитель _____________».
- Print CSS: page constrained to `max-w-[800px] mx-auto p-8 text-black bg-white`, a fixed «Печать» button calling `window.print()` wrapped in a `print:hidden` class.
- i18n: the print DOCUMENT itself is always Russian (it is an RF payment document — not translated); UI chrome around it uses i18n. New keys: `billingInvoices` «Счета», `billingInvoiceCreate` «Выставить счёт», `billingStatusIssued` «Выставлен», `billingStatusPaid` «Оплачен», `billingStatusCancelled` «Отменён», `billingMarkPaid` «Отметить оплаченным», `billingCancelInvoice` «Отменить счёт», `billingMarkPaidConfirmTitle` «Подтвердите оплату счёта», `billingMarkPaidApplies` «Будет применено:», `billingInvoiceCreated` «Счёт {{number}} выставлен», `billingInvoicePaidToast` «Счёт оплачен, применено позиций: {{count}}», `billingOpenPrint` «Открыть», `billingPrint` «Печать».

- [ ] **Step 1: Failing tests.** BillingInvoices: mocked list renders numbers/status badges; mark-paid flow calls detail then mark-paid POST and shows success toast; 409 from POST surfaces server error text. InvoicePrint: mocked invoice with one VAT-20 line (amount 120) and one no-VAT line renders «Счёт на оплату № СЧ-2026-0007», «В том числе НДС: 20 ₽», the `total_in_words` string, and no `<nav>`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Web full gate (npm ci fresh, test, tsc -b, eslint, build).**
- [ ] **Step 5: Commit** — `feat(console): invoices page with mark-paid application + RF print view`

---

### Task 12: Console — OrganizationDetail: счета и надбавки

**Files:**
- Modify: `web/src/pages/super-admin/OrganizationDetail.tsx`, `web/src/i18n.ts`
- Test: extend `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`

**Interfaces:**
- Consumes: `GET /api/super-admin/billing/invoices?tenant_id=` and `active_boosts` from the stats payload (Task 9).

- [ ] **Step 1: Failing test:** with mocked stats containing `active_boosts: [{limit_key: 'attendees_per_event', delta: 1000, valid_until: <future ISO>}]` and a mocked invoices response, the page renders a «Счета» section with the invoice number and a boost chip «+1 000 · Посетители на мероприятие · до {date}» near the limits.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** add `{ id: 'invoices', labelKey: 'td_nav_invoices' }` to `SECTIONS` between `subscription` and `lifecycle`; add the invoices fetch to the existing `Promise.all` in `loadData()`; render `<section id="invoices">` — compact table (Номер/Дата/Сумма/Статус) with a link to the print view and an «Выставить счёт» button deep-linking to `/billing/invoices` (`?tenant=` preselect optional — keep simple: plain link). In the `subscription` section's limits list, render active boosts as muted badges using existing limit-key labels (`billingLimitAttendees` etc.) + `t('billingBoostUntil', {date})`. New keys: `td_nav_invoices` «Счета», `billingBoostUntil` «до {{date}}», `billingNoInvoices` «Счетов пока нет».
- [ ] **Step 4: Web full gate.**
- [ ] **Step 5: Commit** — `feat(console): tenant detail — invoices section + active limit boosts`

---

### Task 13: Panel — «Оплата»: profile, catalog, invoices, print

**Files:**
- Create: `panel/src/features/billing/BillingPage.tsx`, `panel/src/features/billing/InvoicePrintPage.tsx`, `panel/src/features/billing/hooks.ts`, `panel/src/features/billing/vat.ts`, `panel/src/features/billing/BillingPage.test.tsx`, `panel/src/features/billing/InvoicePrintPage.test.tsx`
- Modify: `panel/src/app/router.tsx`, `panel/src/app/shell/NavDrawer.tsx`, `panel/src/shared/i18n/en.json`, `panel/src/shared/i18n/ru.json`

**Interfaces:**
- Consumes: Task 8 generated types/paths via `$api` (`panel/src/shared/api/query.ts`); ui from `@idento/ui`; `useScrollSpy` (`panel/src/shared/hooks/useScrollSpy.ts`).
- Produces `hooks.ts` (exact shape — follow `features/events/hooks.ts` conventions):

```ts
export const BILLING_INVOICES_KEY = ["get", "/api/billing/invoices"] as const;
export function useBillingProfile() { return $api.useQuery("get", "/api/billing/profile", {}, { retry: false }); }
export function useSaveBillingProfile() { /* $api.useMutation("put", "/api/billing/profile") + invalidate profile */ }
export function useBillingCatalog() { return $api.useQuery("get", "/api/billing/catalog"); }
export function useBillingInvoices() { return $api.useQuery("get", "/api/billing/invoices"); }
export function useRequestInvoice() { /* $api.useMutation("post", "/api/billing/invoices") + invalidate BILLING_INVOICES_KEY */ }
export function useBillingInvoice(id: string) { return $api.useQuery("get", "/api/billing/invoices/{id}", { params: { path: { id } } }); }
```

**Page spec** — route `/billing`, nav item `navBilling` «Оплата» in `NavDrawer.tsx` after `navOrganization`; anchor-rail + stacked sections pattern (as `EventSettingsPage.tsx`): sections `billing-profile`, `billing-catalog`, `billing-invoices`.
- Profile card: plain-useState + zod form (copy `OrganizationForm` structure): legal_name, inn, kpp, legal_address; zod: inn `/^\d{10}$|^\d{12}$/` (error key `billingInnInvalid`), kpp empty-or-9-digits (`billingKppInvalid`), name/address min 1 (`billingFieldRequired`); 404 from `useBillingProfile` = empty form (not an error state — that's why `retry: false`).
- Catalog card: public items as rows (name, description, price ₽, VAT note, kind badge) with quantity steppers; sticky footer «Итого {sum} ₽» + «Запросить счёт» button (disabled at qty-all-zero; also disabled with hint `billingProfileFirst` when no profile). Success → toast with invoice number, quantities reset, invoices list invalidated. 409 responses surface the server message.
- Invoices card: grid-row table (follow `AttendeeTable.tsx` CSS-grid pattern): Номер / Дата / Сумма / Статус (status → `billingStatusIssued|Paid|Cancelled` labels) / «Открыть» link to `/billing/invoices/$invoiceId/print`. Empty state via `EmptyState`.
- `InvoicePrintPage` — route `/billing/invoices/$invoiceId/print` registered as a child of `protectedLayoutRoute`'s PARENT (i.e., outside the shell chrome — same protected guard, no NavDrawer; follow how the router file structures a chrome-less route, or render the shell-less layout inside the component with `print:hidden` on any chrome). Document layout: IDENTICAL structural contract to Task 11's InvoicePrint (bank header grid, title, поставщик/покупатель, lines table, VAT totals via local `vat.ts` copy of `includedVat`, `total_in_words`, «Печать» button `print:hidden`). Document text is always Russian.
- i18n keys (BOTH files, flat camelCase; ru values): `navBilling` «Оплата», `billingTitle` «Оплата», `billingProfileSection` «Реквизиты организации», `billingCatalogSection` «Каталог услуг», `billingInvoicesSection` «Счета», `billingLegalName` «Юридическое название», `billingInn` «ИНН», `billingKpp` «КПП», `billingLegalAddress` «Юридический адрес», `billingInnInvalid` «ИНН — 10 или 12 цифр», `billingKppInvalid` «КПП — 9 цифр», `billingFieldRequired` «Обязательное поле», `billingProfileSaved` «Реквизиты сохранены», `billingProfileFirst` «Сначала заполните реквизиты организации», `billingRequestInvoice` «Запросить счёт», `billingInvoiceRequested` «Счёт {{number}} выставлен», `billingTotal` «Итого», `billingNoVat` «Без НДС», `billingVatIncluded` «в т.ч. НДС {{rate}}%», `billingStatusIssued` «Выставлен», `billingStatusPaid` «Оплачен», `billingStatusCancelled` «Отменён», `billingNoInvoices` «Счетов пока нет», `billingOpen` «Открыть», `billingPrint` «Печать», `billingKindPlan` «Тариф», `billingKindService` «Услуга», `billingKindAddon` «Надбавка».

- [ ] **Step 1: Failing tests** (MSW via `startMswServer`, fresh QueryClient, `import "../../shared/i18n"`; fixtures typed from `components["schemas"]["..."]`):
  - BillingPage: profile 404 → empty form renders; filling INN "123" shows `ИНН — 10 или 12 цифр`; catalog with 2 items → stepping qty to 1 enables «Запросить счёт», POST body contains `{catalog_item_id, quantity: 1}`, success toast contains the mocked number; invoices list renders status labels.
  - InvoicePrintPage: renders number, «Без НДС» totals branch, and total_in_words.
- [ ] **Step 2: Run → FAIL** (`npm test -w panel -- billing`).
- [ ] **Step 3: Implement** (router entries, NavDrawer item, pages, hooks, both i18n files).
- [ ] **Step 4: Panel full gate:** `npm test -w panel && npm run typecheck -w panel && rtk proxy npm run lint -w panel` — `keyParity.test.ts` must pass (en↔ru parity).
- [ ] **Step 5: Commit** — `feat(panel): billing page — requisites, catalog self-service, invoices + print view`

---

## Final verification (controller, after all tasks)

- Full gates: backend (`go build`, `go test -count=1 ./...` with TEST_DATABASE_URL, `golangci-lint run ./internal/...`), `npm test -w panel` + `npm run typecheck -w panel` + panel lint, web fresh `npm ci` + test + `tsc -b` + eslint + build.
- Live walk on the dev stand (skill `running-idento-locally`): set `BILLING_SELLER_*` env in root `.env`; create one catalog item of each kind in the console; fill requisites in the panel; request an invoice; open print view; mark paid in console; verify subscription/limits change in the console meters and boost chip.
- Final whole-branch review on the strongest model with the review package over `git merge-base main HEAD`.
