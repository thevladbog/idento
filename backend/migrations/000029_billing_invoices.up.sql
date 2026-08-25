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
