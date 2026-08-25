# Subscription plans: Russian names + ruble prices

Status: approved (owner decisions 2026-08-25)

## Problem

The product operates in the Russian market, but subscription plans are
English-named with implied-USD prices:

- **DB** (`subscription_plans`, seeded by `backend/internal/store/seed.go`):
  "Free / Starter / Professional / Enterprise" with English descriptions and
  bare `DECIMAL` prices (29/290, 99/990) whose currency exists only in the
  console's markup.
- **Console** (`web/src/pages/super-admin/SubscriptionPlans.tsx`): hardcoded
  `$` glyphs (`${plan.price_monthly}`, form labels "($)").
- **Landing** (`landing/src/components/sections/Pricing.tsx` +
  `messages/{ru,en}.json`): marketing copy already localized, but prices are
  "$0/$49/$39" even in the RU locale — and the landing's plan grid
  (free/professional $49/enterprise) does not match the DB grid
  (free/starter $29/pro $99/enterprise).

## Owner decisions (locked)

1. **Single-currency system, currency = RUB.** No `currency` column, no
   multi-currency, no on-the-fly conversion. The bare numbers now mean
   rubles; only display layers change.
2. **Prices:** Стартовый 2 990 ₽/мес, 29 900 ₽/год; Профессиональный
   9 990 ₽/мес, 99 900 ₽/год (annual keeps the ~2-months-free shape).
   Бесплатный and Корпоративный stay 0.
3. **Names in Russian:** Бесплатный / Стартовый / Профессиональный /
   Корпоративный, with Russian descriptions. Slugs (`free/starter/pro/
   enterprise/unlimited`) and `tier` values stay Latin — they are technical
   keys (web filters by `plan.slug`, tests reference them).

## Scope

### 1. Seed data — `backend/internal/store/seed.go`

`saasPlanSeeds` gets Russian names/descriptions and ruble prices. The
on-prem `Unlimited` plan is `is_public = FALSE` and never user-facing, but
is russified too («Безлимитный», Russian description) for consistency —
zero-price, so no price change.

### 2. Data migration — `backend/migrations/000028_russify_plan_seeds.up.sql`

Live databases already hold the English seed rows. Update them **keyed by
slug AND guarded by the old default value**, so operator customizations made
through the console's plan editor are never clobbered:

- `SET name = <русское имя> WHERE slug = ... AND name = '<old English default>'`
- `SET description = ... WHERE slug = ... AND description = '<old default>'`
- `SET price_monthly = 2990, price_yearly = 29900 WHERE slug = 'starter' AND price_monthly = 29 AND price_yearly = 290`
  (same shape for `pro` 99/990 → 9990/99900).

Name/description and price guards are independent statements: an operator
who changed only the price still gets the rename, and vice versa. Down
migration restores the English defaults with the same guarded shape
(matching on the new Russian values).

### 3. Console — `web/src/pages/super-admin/SubscriptionPlans.tsx`

- Price display: `${plan.price_monthly}` → ru-RU-grouped number + ₽
  (`2 990 ₽`), one tiny local formatter (no library).
- Form labels: `(₽)` instead of `($)`.
- Sweep the console for any other `$`-as-currency renders (audit-log plan
  diffs print bare numbers — left as-is, they are value diffs, not prices).

### 4. Landing — `messages/ru.json` + `messages/en.json`

Both locales switch to ruble prices (one market, two languages):
free `0 ₽`, professional `9 990 ₽` monthly / `8 325 ₽` on the annual toggle
(= 99 900 ₽ / 12), enterprise «Индивидуально» / "Custom". The
three-card marketing grid deliberately stays (no Starter card — the
marketing page is a narrower storefront than the product grid), but the
professional card's price now equals the DB's Professional plan, closing
the $49-vs-$99 drift.

### Out of scope

- Multi-currency schema, exchange rates, per-market pricing.
- Payment processing (none exists).
- Adding a Starter card to the landing grid.
- Translating `slug`/`tier` values or any technical identifiers.

## Testing

- Migration content test in `backend/internal/store` (000026/000027
  precedent): guarded-update invariants — every UPDATE carries both the
  slug key and the old-default guard; down restores guarded English.
- Console: `SubscriptionPlans.test.tsx` fixtures/assertions move to the
  ₽ format (and pin the ru-RU grouping, e.g. "2 990 ₽").
- Seed: if a seed test exists, update its expectations; otherwise the
  real-DB verification below covers it.
- Real-DB verification: the long-lived dev database holds untouched
  English seed rows — running the migration there IS the live test of the
  guarded updates (before/after `SELECT name, price_monthly`).
- Landing has no unit tests for messages; `next build` + visual check.
