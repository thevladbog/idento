# Billing: catalog, bank-transfer invoices, limit add-ons, subscription lifecycle

Status: draft — decisions locked in brainstorming 2026-08-25, awaiting owner review

## Problem

Plans now have Russian names, ruble prices, and working limit enforcement
(users / events_per_month / attendees_per_event bite through middleware;
TenantGate blocks suspended tenants and expired/cancelled subscriptions).
But nothing connects plans to money, and nothing ever *changes* a
subscription: there is no way to issue an invoice, record a payment, extend
a period, sell an implementation service, or top up a single limit — and no
automation ever moves `trial`/`active` to `expired`, so "expiry" never
happens.

## Owner decisions (locked)

1. **Payment = bank transfer against an invoice.** No PSP/online checkout
   in this project. Seller is an ИП на НПД (no VAT by default, ИНН without
   КПП); seller requisites are backend configuration.
2. **Catalog of billable items**, operator-managed, three kinds:
   - **plan** — linked to a subscription plan + period (month/year), with
     an activation mode;
   - **service** — free-form paid work (внедрение, консультация); payment
     has no subscription effect;
   - **addon** — a delta on ONE limit (e.g. +1000 attendees_per_event) on
     top of the current plan, valid until the current period's end or for
     a fixed number of days. Does not change the plan.
3. **VAT is chosen per line** (default «Без НДС»); when a rate is set, RF
   convention applies: the price *includes* VAT («в т.ч. НДС X%»).
4. **Both sides can initiate**: the tenant requests an invoice from the
   panel (picking public catalog items); the operator can compose and issue
   an invoice to any tenant from the console.
5. **Activation modes for plan items**: `on_payment` (apply immediately —
   the upgrade case), `after_current` (extend from the current period's
   end — the renewal default; money must not burn), `manual` (operator
   applies by hand — escape hatch).
6. **Minimal subscription lifecycle automation ships in this project**: a
   background ticker (retention-ticker precedent) moves `trial` past
   `trial_end_date` and `active` past `end_date` to `expired`. TenantGate
   already blocks `expired` — this makes "the current period ends" real,
   which the `after_current` mode and addon validity depend on.

## Data model (new tables, migration 000029)

- **`tenant_billing_profiles`** — buyer requisites, one per tenant:
  `tenant_id PK/FK CASCADE`, `legal_name`, `inn`, `kpp NULL`,
  `legal_address`, timestamps. Editable by the tenant in the panel and by
  the operator in the console.
- **`billing_catalog_items`**: `id`, `kind` (`plan|service|addon`), `name`,
  `description`, `price NUMERIC(10,2)`, `vat_rate NUMERIC(4,2) NULL`
  (NULL = Без НДС; a value means "included in price"), `is_public`
  (visible to tenants for self-service), `is_active`, `sort_order`;
  plan kind: `plan_id FK`, `period` (`month|year`), `default_activation`
  (`on_payment|after_current|manual`); addon kind: `limit_key`
  (`attendees_per_event|events_per_month|users`), `limit_delta INT > 0`,
  `validity` (`until_period_end|fixed_days`), `validity_days INT NULL`.
  CHECK constraints keep kind-fields consistent (plan fields only on plan
  kind, addon fields only on addon kind).
- **`invoices`**: `id`, `number` UNIQUE (format `СЧ-<year>-<NNNN>`,
  per-year sequence via a counter table or MAX+1 inside the issuing tx),
  `tenant_id FK`, `status` (`issued|paid|cancelled`), `issued_at`,
  `paid_at NULL`, `cancelled_at NULL`, buyer snapshot (`buyer_name`,
  `buyer_inn`, `buyer_kpp NULL`, `buyer_address`), seller snapshot
  (`seller_name`, `seller_inn`, `seller_bank`, `seller_account`,
  `seller_bik`, copied from config at issue time), `total NUMERIC(12,2)`,
  `comment NULL`, `created_by UUID NULL` (user who created it),
  timestamps. No draft state in v1: composing happens client-side; saving
  creates the invoice already `issued` with its number.
- **`invoice_lines`**: `id`, `invoice_id FK CASCADE`, `position INT`,
  full **snapshot** of the catalog item at issue time (`catalog_item_id
  NULL` reference + copied `kind/name/price/vat_rate/plan_id/period/
  activation/limit_key/limit_delta/validity/validity_days`), `quantity
  INT >= 1`, `amount NUMERIC(12,2)` (= price × qty). Later catalog edits
  must never mutate issued invoices.
- **`limit_boosts`**: `id`, `tenant_id FK CASCADE`, `limit_key`,
  `delta INT`, `valid_until TIMESTAMPTZ` (always resolved to a concrete
  date at application time: current `end_date` snapshot for
  `until_period_end`, `paid_at + validity_days` for `fixed_days`),
  `source_invoice_line_id FK NULL`, `created_at`. Deliberately a snapshot:
  a later subscription extension does NOT stretch an old boost («разово и
  до завершения текущей подписки»).

## Application semantics (on "mark paid", one `Store.WithTx`)

Marking an invoice paid sets `status='paid'`, `paid_at=now()`, writes an
`admin_audit_log` entry, and applies every line atomically:

- **service** — no effect beyond the paid record.
- **plan / `on_payment`** — subscription upsert: `plan_id` = line's plan,
  `status='active'`, `end_date` = now + period (month=+1 month,
  year=+1 year) × quantity.
- **plan / `after_current`** — `plan_id` unchanged-or-set the same way,
  `end_date` = max(now, current `end_date`) + period × quantity,
  `status='active'` (a renewal also revives an `expired` subscription).
  If the line's plan differs from the current plan, the plan switches at
  application time but the period still chains from the current end — the
  operator picked this mode deliberately.
- **plan / `manual`** — nothing automatic; the operator applies via the
  existing console subscription editor. The line is listed in the paid
  invoice as "manual application".
- **addon** — insert a `limit_boosts` row with `delta × quantity` and the
  resolved `valid_until`. `until_period_end` with no current `end_date`
  (e.g. free plan, NULL end) fails the mark-paid with a clear 409 — the
  operator must fix the subscription first or use `fixed_days`.

Mark-paid is idempotent-guarded (only `issued → paid`); `cancelled` is
terminal and only reachable from `issued`.

## Effective limits (enforcement + display)

`resolveTenantLimit` (pg_store.go:2507) gains boost awareness: after
resolving custom/plan limit, if the value is not unlimited (-1), add
`COALESCE(SUM(delta) WHERE tenant AND limit_key AND valid_until > NOW())`.
One code path feeds both `CheckTenantLimit` and `CheckAttendeeLimit`, so
every existing enforcement point (users/events/attendees middleware, bulk
import, API keys, sync) honors boosts with no per-callsite changes.
`GetTenantStats` exposes `active_boosts` (key, delta, valid_until)
(list-level boost exposure deferred) so the console's limit meters can show
«9 990 (тариф) + 1 000 (надбавка до 12.09)»-style truth; the panel's own
usage surfaces read the same effective numbers through existing endpoints.

## Lifecycle ticker (`internal/billing` or extend `internal/retention` pattern)

Periodic goroutine (config `SUBSCRIPTION_LIFECYCLE_INTERVAL`,
default 1h, 0 disables): one guarded UPDATE moving `status='trial' AND
trial_end_date < NOW()` and `status='active' AND end_date IS NOT NULL AND
end_date < NOW()` to `expired`, each transition audited
(`subscription_expired`, NULL actor, machine reason in changes). On-prem
mode: ticker disabled (self-hosted installs are not metered — same stance
as plan seeds).

## Surfaces

**Console (operator):**
- «Каталог» page: CRUD for catalog items (kind-aware form).
- «Счета» page: list with status filters; create (pick tenant → billing
  profile check → add lines from catalog with qty → issue: number
  assigned, snapshots taken); actions: mark paid (with confirmation
  showing exactly what will be applied), cancel; open print view.
- Tenant detail: invoices section + active boosts shown next to limits.

**Panel (tenant admin):**
- «Оплата» section (Organization page area): billing profile form
  (legal_name/ИНН/КПП/address); public catalog with «Запросить счёт»
  (creates an issued invoice for the chosen items — self-service, no
  operator round-trip); invoice list with statuses and print view.

**Invoice document:** print-friendly HTML view (browser "Save as PDF"), a
standard RF «Счёт на оплату» layout: seller/buyer requisites, table of
lines (№, наименование, кол-во, цена, сумма), «в т.ч. НДС»/«Без НДС»
per the lines, total in figures and words (amount-in-words helper),
number/date. Server-side PDF generation is deliberately out of scope.

## Out of scope

- Online payments / PSP, автосписания, dunning-письма.
- Чеки НПД («Мой налог» — ручной процесс продавца).
- Акты/закрывающие документы, УПД.
- Storage_mb enforcement (still display-only; separate decision later).
- Editing issued invoices (cancel + reissue instead).

**Retention interplay:** invoices are retained financial documents (РФ:
обязательное хранение бухгалтерских документов), so they must survive tenant
hard-purge. Migration 000030 switches `invoices.tenant_id` from `ON DELETE
CASCADE` to `ON DELETE RESTRICT`, and `PurgeExpiredTenants`
(`internal/store/pg_store_retention.go`) skips any archived tenant past
retention that still has invoices — such a tenant stays archived
indefinitely until an operator handles it manually. This is by design:
tenant hard-purge and invoice retention are deliberately in tension, and
invoices win.

## Testing

- Store: migration content test (guards/CHECKs per 000026-28 precedent);
  real-Postgres integration tests for the two money paths — mark-paid
  application semantics (all three activation modes + addon resolution +
  the free-plan-409) and effective-limit resolution with active/expired
  boosts; per-year invoice numbering under the issuing tx.
- Handler: invoice issue/mark-paid/cancel state machine (pgxmock/fakeStore),
  tenant self-service authorization (tenant sees only own invoices; profile
  required before issue), lifecycle ticker transitions (guarded UPDATE
  content + audit rows).
- Web console + panel: component tests for catalog CRUD form (kind-aware
  fields), invoice composer math (qty × price, VAT line rendering), status
  actions gating; print view renders all requisites and «Без НДС» marks.
- Live walk on the dev stand: catalog item of each kind → tenant requests
  invoice → operator marks paid → limits/subscription verified via console
  meters and TenantGate behavior.
