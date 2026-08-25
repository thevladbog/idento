# Ruble Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Russian plan names/descriptions and ruble prices across seed data, live databases, the operator console, and the landing pricing page.

**Architecture:** The system stays single-currency; the bare DECIMAL prices now mean rubles. Seed strings change for fresh installs; migration 000028 updates live rows guarded by slug + old-default value so operator edits survive; display layers swap `$` for ru-RU-formatted `₽`.

**Tech Stack:** Go (seed + migration), React/TS (console), Next.js messages JSON (landing).

**Design doc:** `docs/superpowers/specs/2026-08-25-ruble-plans-design.md`.

## Global Constraints

- Slugs (`free/starter/pro/enterprise/unlimited`) and `tier` values stay Latin — technical keys, referenced by web filters and tests.
- Prices (owner-locked): Стартовый 2990/29900, Профессиональный 9990/99900, others 0.
- Migration updates are guarded: `WHERE slug = ... AND <field> = <old English/old price default>` — customized rows must never be clobbered.
- Console lint/typecheck/tests run against a fresh `npm ci` in `web/` (standalone lockfile).

---

### Task 1: Russify the seed data (`backend/internal/store/seed.go`)

**Files:**
- Modify: `backend/internal/store/seed.go:12-33`

**Interfaces:**
- Produces: the exact new name/description/price literals Task 2's migration and Task 2's test guard against — copy them verbatim from here.

- [ ] **Step 1: Replace `saasPlanSeeds` and `onPremPlanSeeds`**

Replace the two constants with:

```go
// saasPlanSeeds mirrors the tiers previously seeded by migration 000009,
// russified 2026-08-25 (single-currency system; prices are rubles).
const saasPlanSeeds = `
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features, sort_order) VALUES
('Бесплатный', 'free', 'free', 'Для небольших мероприятий и знакомства с сервисом', 0, 0,
 '{"events_per_month": 2, "attendees_per_event": 50, "users": 2, "storage_mb": 100}',
 '{"custom_branding": false, "api_access": false, "priority_support": false}', 1),
('Стартовый', 'starter', 'starter', 'Для растущих организаций', 2990, 29900,
 '{"events_per_month": 10, "attendees_per_event": 500, "users": 5, "storage_mb": 1000}',
 '{"custom_branding": true, "api_access": false, "priority_support": false}', 2),
('Профессиональный', 'pro', 'pro', 'Для профессиональных организаторов мероприятий', 9990, 99900,
 '{"events_per_month": -1, "attendees_per_event": 5000, "users": 20, "storage_mb": 10000}',
 '{"custom_branding": true, "api_access": true, "priority_support": true}', 3),
('Корпоративный', 'enterprise', 'enterprise', 'Индивидуальное решение для крупных организаций', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": true, "dedicated_support": true}', 4)
ON CONFLICT (slug) DO NOTHING`

// onPremPlanSeeds: one hidden, unlimited plan — self-hosted installs are not metered.
const onPremPlanSeeds = `
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features, is_public, sort_order) VALUES
('Безлимитный', 'unlimited', 'custom', 'Безлимитный тариф для самостоятельного развёртывания', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": false}', FALSE, 0)
ON CONFLICT (slug) DO NOTHING`
```

- [ ] **Step 2: Build and run the store suite**

Run (from `backend/`): `go build ./... && go test ./internal/store`
Expected: PASS (no test pins the English seed strings today; if one fails, update its expectation to the new literals).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/store/seed.go
git commit -m "feat(backend): russify plan seed data with ruble prices"
```

---

### Task 2: Guarded data migration 000028 + content test

**Files:**
- Create: `backend/migrations/000028_russify_plan_seeds.up.sql`
- Create: `backend/migrations/000028_russify_plan_seeds.down.sql`
- Test: `backend/internal/store/pg_store_russify_plans_test.go`

**Interfaces:**
- Consumes: Task 1's exact new literals (names/descriptions/prices above).

- [ ] **Step 1: Write the failing content test**

```go
package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestRussifyPlanSeedsMigrationGuardsOperatorEdits pins migration 000028:
// every UPDATE must be keyed by slug AND guarded by the old English/old
// price default, so plans an operator already customized through the
// console's plan editor are never clobbered. Name/description and price
// updates are independent statements (a price-only edit still gets the
// rename, and vice versa).
func TestRussifyPlanSeedsMigrationGuardsOperatorEdits(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	migrationsDir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000028_russify_plan_seeds.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000028_russify_plan_seeds.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.Join(strings.Fields(strings.ToLower(string(downBytes))), " ")

	for _, fragment := range []string{
		// renames, keyed by slug + old default name
		"set name = 'бесплатный' where slug = 'free' and name = 'free'",
		"set name = 'стартовый' where slug = 'starter' and name = 'starter'",
		"set name = 'профессиональный' where slug = 'pro' and name = 'professional'",
		"set name = 'корпоративный' where slug = 'enterprise' and name = 'enterprise'",
		"set name = 'безлимитный' where slug = 'unlimited' and name = 'unlimited'",
		// prices, keyed by slug + BOTH old default prices
		"set price_monthly = 2990, price_yearly = 29900 where slug = 'starter' and price_monthly = 29 and price_yearly = 290",
		"set price_monthly = 9990, price_yearly = 99900 where slug = 'pro' and price_monthly = 99 and price_yearly = 990",
	} {
		if !strings.Contains(up, fragment) {
			t.Errorf("up migration missing guarded update %q", fragment)
		}
	}
	if strings.Contains(up, "where slug = 'free';") || strings.Contains(up, "where slug = 'starter';") {
		t.Error("up migration contains an unguarded slug-only update")
	}

	for _, fragment := range []string{
		"set name = 'free' where slug = 'free' and name = 'бесплатный'",
		"set price_monthly = 29, price_yearly = 290 where slug = 'starter' and price_monthly = 2990 and price_yearly = 29900",
	} {
		if !strings.Contains(down, fragment) {
			t.Errorf("down migration missing guarded restore %q", fragment)
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `backend/`): `go test ./internal/store -run TestRussifyPlanSeeds`
Expected: FAIL — "read up migration: … no such file".

- [ ] **Step 3: Write the up migration**

`backend/migrations/000028_russify_plan_seeds.up.sql`:

```sql
-- Russify the plan rows seeded in English by seed.go's pre-2026-08-25
-- defaults, and move the two paid tiers to ruble prices (the system is
-- single-currency; the numbers now mean rubles — see
-- docs/superpowers/specs/2026-08-25-ruble-plans-design.md).
--
-- Every UPDATE is guarded by the OLD default value in addition to the slug:
-- a plan the operator already renamed/repriced through the console's plan
-- editor is theirs and must not be clobbered. Name/description and price
-- updates are independent so a partial customization keeps the rest.

UPDATE subscription_plans SET name = 'Бесплатный' WHERE slug = 'free' AND name = 'Free';
UPDATE subscription_plans SET name = 'Стартовый' WHERE slug = 'starter' AND name = 'Starter';
UPDATE subscription_plans SET name = 'Профессиональный' WHERE slug = 'pro' AND name = 'Professional';
UPDATE subscription_plans SET name = 'Корпоративный' WHERE slug = 'enterprise' AND name = 'Enterprise';
UPDATE subscription_plans SET name = 'Безлимитный' WHERE slug = 'unlimited' AND name = 'Unlimited';

UPDATE subscription_plans SET description = 'Для небольших мероприятий и знакомства с сервисом' WHERE slug = 'free' AND description = 'For small events and testing';
UPDATE subscription_plans SET description = 'Для растущих организаций' WHERE slug = 'starter' AND description = 'For growing organizations';
UPDATE subscription_plans SET description = 'Для профессиональных организаторов мероприятий' WHERE slug = 'pro' AND description = 'For professional event organizers';
UPDATE subscription_plans SET description = 'Индивидуальное решение для крупных организаций' WHERE slug = 'enterprise' AND description = 'Custom solution for large organizations';
UPDATE subscription_plans SET description = 'Безлимитный тариф для самостоятельного развёртывания' WHERE slug = 'unlimited' AND description = 'Self-hosted unlimited plan';

UPDATE subscription_plans SET price_monthly = 2990, price_yearly = 29900 WHERE slug = 'starter' AND price_monthly = 29 AND price_yearly = 290;
UPDATE subscription_plans SET price_monthly = 9990, price_yearly = 99900 WHERE slug = 'pro' AND price_monthly = 99 AND price_yearly = 990;
```

- [ ] **Step 4: Write the down migration**

`backend/migrations/000028_russify_plan_seeds.down.sql`:

```sql
-- Restore the English seed defaults with the same guarded shape (only rows
-- still at the 000028 values are touched).
UPDATE subscription_plans SET name = 'Free' WHERE slug = 'free' AND name = 'Бесплатный';
UPDATE subscription_plans SET name = 'Starter' WHERE slug = 'starter' AND name = 'Стартовый';
UPDATE subscription_plans SET name = 'Professional' WHERE slug = 'pro' AND name = 'Профессиональный';
UPDATE subscription_plans SET name = 'Enterprise' WHERE slug = 'enterprise' AND name = 'Корпоративный';
UPDATE subscription_plans SET name = 'Unlimited' WHERE slug = 'unlimited' AND name = 'Безлимитный';

UPDATE subscription_plans SET description = 'For small events and testing' WHERE slug = 'free' AND description = 'Для небольших мероприятий и знакомства с сервисом';
UPDATE subscription_plans SET description = 'For growing organizations' WHERE slug = 'starter' AND description = 'Для растущих организаций';
UPDATE subscription_plans SET description = 'For professional event organizers' WHERE slug = 'pro' AND description = 'Для профессиональных организаторов мероприятий';
UPDATE subscription_plans SET description = 'Custom solution for large organizations' WHERE slug = 'enterprise' AND description = 'Индивидуальное решение для крупных организаций';
UPDATE subscription_plans SET description = 'Self-hosted unlimited plan' WHERE slug = 'unlimited' AND description = 'Безлимитный тариф для самостоятельного развёртывания';

UPDATE subscription_plans SET price_monthly = 29, price_yearly = 290 WHERE slug = 'starter' AND price_monthly = 2990 AND price_yearly = 29900;
UPDATE subscription_plans SET price_monthly = 99, price_yearly = 990 WHERE slug = 'pro' AND price_monthly = 9990 AND price_yearly = 99900;
```

- [ ] **Step 5: Run the test to verify it passes, then the full backend**

Run (from `backend/`): `go test ./internal/store -run TestRussifyPlanSeeds` → PASS, then `go test -count=1 ./... && go build ./... && golangci-lint run ./internal/...` → all green.

- [ ] **Step 6: Real-DB verification against the dev database**

```bash
docker compose up -d db && sleep 3
docker exec idento_db psql -U idento -d idento_db -c "SELECT slug, name, price_monthly FROM subscription_plans ORDER BY sort_order"
TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
  go test ./internal/store -run TestPurgeExpiredTenants_RealPostgres -v   # any real-DB test triggers RunMigrations
docker exec idento_db psql -U idento -d idento_db -c "SELECT slug, name, price_monthly FROM subscription_plans ORDER BY sort_order"
```

Expected: before — English names, 29/99; after — «Бесплатный/Стартовый/Профессиональный/Корпоративный», 2990/9990.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/000028_russify_plan_seeds.up.sql backend/migrations/000028_russify_plan_seeds.down.sql backend/internal/store/pg_store_russify_plans_test.go
git commit -m "feat(backend): guarded migration russifying live plan rows to ruble prices"
```

---

### Task 3: Console shows rubles (`web/`)

**Files:**
- Modify: `web/src/pages/super-admin/SubscriptionPlans.tsx:218-225` (price display), `:315` and `:323` (form labels)
- Test: `web/src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx`

**Interfaces:**
- Produces: `formatRub(value: number): string` — module-local helper in `SubscriptionPlans.tsx`, e.g. `formatRub(2990) === "2 990 ₽"` (ru-RU grouping uses non-breaking narrow spaces from `toLocaleString`; assert via the rendered text, not a hand-typed space).

- [ ] **Step 1: Write the failing test**

Add to `web/src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx` (fixture `price_monthly: 29, price_yearly: 290` → change to `2990`/`29900` in `mockPlans`, then):

```tsx
  it('renders prices as ru-RU-formatted rubles, not dollars', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    // 2990 formatted by Intl for ru-RU + the ruble sign; no dollar anywhere.
    const expected = `${(2990).toLocaleString('ru-RU')} ₽`;
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
```

(Reuse the file's existing render helper; if it renders inline, copy the surrounding test's render call verbatim.)

- [ ] **Step 2: Run it to verify it fails**

Run (from `web/`, after `npm ci`): `npx vitest run src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx`
Expected: FAIL — `$2990` rendered, no ruble text.

- [ ] **Step 3: Implement**

In `SubscriptionPlans.tsx`, add near the top (after imports):

```tsx
// Single-currency system: the bare plan prices are rubles (see
// docs/superpowers/specs/2026-08-25-ruble-plans-design.md).
function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU')} ₽`;
}
```

Replace the price display block:

```tsx
                <div className="text-3xl font-bold">
                  {formatRub(plan.price_monthly)}
                  <span className="text-sm text-muted-foreground font-normal">{t('perMonth')}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatRub(plan.price_yearly)}{t('perYear')}
                </div>
```

Replace the two form labels:

```tsx
                <Label>{t('priceMonthly')} (₽)</Label>
```
```tsx
                <Label>{t('priceYearly')} (₽)</Label>
```

- [ ] **Step 4: Sweep the console for other `$`-as-currency renders**

Run: `grep -rn '\\$' web/src/pages/super-admin web/src/components --include='*.tsx' | grep -v '\\${' | grep -v test`
Expected: no currency-glyph hits (template literals and the audit diff's bare numbers don't count). If any appear, apply `formatRub` the same way.

- [ ] **Step 5: Run web gates**

Run (from `web/`): `npx vitest run src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx` → PASS; then `npm test && npx tsc -b && npx eslint . && npm run build` → all green.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/super-admin/SubscriptionPlans.tsx web/src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx
git commit -m "feat(web): console renders plan prices as ru-RU rubles"
```

---

### Task 4: Landing prices in rubles (both locales)

**Files:**
- Modify: `landing/messages/ru.json` (`Pricing.plans.*.price`)
- Modify: `landing/messages/en.json` (`Pricing.plans.*.price`)

**Interfaces:**
- Consumes: owner-locked prices (Professional 9 990 ₽/мес; annual toggle shows the per-month equivalent 99 900 ₽ / 12 = 8 325 ₽).

- [ ] **Step 1: Update `ru.json`**

In `Pricing.plans`: `free.price` → `{"monthly": "0 ₽", "annual": "0 ₽"}`; `professional.price` → `{"monthly": "9 990 ₽", "annual": "8 325 ₽"}`; `enterprise.price` stays `{"monthly": "Индивидуально", "annual": "Индивидуально"}`.

- [ ] **Step 2: Update `en.json`**

Same `Pricing.plans` block: `free.price` → `{"monthly": "0 ₽", "annual": "0 ₽"}`; `professional.price` → `{"monthly": "9 990 ₽", "annual": "8 325 ₽"}`; `enterprise.price` stays `{"monthly": "Custom", "annual": "Custom"}`. (One market, two languages — prices are rubles in both.)

- [ ] **Step 3: Verify build and lint**

Run (from `landing/`): `npm run build && npm run lint`
Expected: build succeeds; lint has 0 errors (2 pre-existing warnings are known).

- [ ] **Step 4: Commit**

```bash
git add landing/messages/ru.json landing/messages/en.json
git commit -m "feat(landing): pricing page shows rubles in both locales"
```

---

### Task 5: Full verification and live walk

**Files:** none (verification only).

- [ ] **Step 1: Full gates once more**

From `backend/`: `go test -count=1 ./...` (with `TEST_DATABASE_URL` set, DB up). From `web/`: `npm test && npx tsc -b && npx eslint . && npm run build`. From `landing/`: `npm run build`.

- [ ] **Step 2: Live browser check**

With the local stand running (skill `running-idento-locally`): console → Subscription Plans shows «Стартовый 2 990 ₽/мес» etc., plan editor labels show (₽); Organizations list plan badges show Russian names.

- [ ] **Step 3: Push and open the PR**

One push (all commits), PR titled "feat: тарифы — русские имена и рублёвые цены" describing the guarded-migration approach.
