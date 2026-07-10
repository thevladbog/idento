# Design: Dual Distribution — SaaS + On-Prem (Single-Tenant)

**Date:** 2026-07-10
**Status:** Approved
**Decisions locked with product owner:**
- On-prem edition is **single-tenant** (one installation = one customer organization).
- **SaaS ships first**; on-prem packaging is phase 2.
- SaaS v1 has **no payment provider** — auto-provisioned Free/trial subscription at registration, upgrades assigned manually by platform operators.
- Editions are implemented as **one codebase with a runtime mode flag** (no build tags, no fork).
- Tenant-management admin v1 scope: tenant lifecycle, manual billing, impersonation, platform analytics.

## 1. Context and Feasibility Verdict

Idento's backend is architecturally multi-tenant already: every table scopes to `tenant_id` directly or via `event_id` (`backend/migrations/000001_init_schema.up.sql`), users can belong to multiple organizations (`000008_multi_org_support.up.sql`), and a billing schema exists (`000009_super_admin_billing.up.sql`: `subscription_plans` with JSON `limits`/`features`, `subscriptions` unique per tenant, `usage_logs`, `admin_audit_log`) with a limits middleware and a super-admin API.

**Verdict: both models are feasible.** SaaS is a hardening effort, not a rebuild. On-prem single-tenant is mostly *subtraction* (hide registration/billing/super-admin) plus packaging, which currently does not exist at all.

Critical defects found during exploration (fixed by this design):

1. **SaaS onboarding is broken.** `Register` (`backend/internal/handler/auth.go`) creates a tenant but never a subscription; `store.CreateSubscription` has zero callers. `CheckTenantLimit` returns "no active subscription" → every new organization gets 403 on creating events/users/attendees.
2. **Tenant isolation is manual and duplicated.** Store methods (`GetEventByID`, `GetAttendeeByID`, …) do not filter by tenant; ~10 handlers repeat `event.TenantID != claims.TenantID` comparisons by hand. One forgotten check is a cross-tenant leak. No Postgres RLS.
3. **Suspension has no effect.** `subscriptions.status` is never checked on the request path; `UpdateTenantSubscription` also 404s when no subscription row exists.
4. **The attendee limit is a stub** (`CheckTenantLimit` sets `current = 0` for `attendees_per_event`).
5. **No deployment packaging.** Zero Dockerfiles; docker-compose is dev-only (postgres/redis/pgadmin; Redis is unused by the backend); migrations are read from a `migrations/` directory on disk relative to cwd; a 15 MB prebuilt binary is committed at `backend/idento-backend`; no release pipeline, no tags, no version endpoint.
6. **Open registration cannot be disabled** — every unauthenticated `POST /auth/register` creates a new tenant; migration `000009` seeds SaaS pricing tiers into any database it runs against.

## 2. Edition Architecture

New config value `DEPLOYMENT_MODE` with values `saas` | `onprem`. **Default: `onprem`** — the safe default for a binary running outside our infrastructure; our SaaS deployment sets `saas` explicitly.

| Concern | `saas` | `onprem` |
|---|---|---|
| `POST /auth/register` | Mounted; creates tenant **+ default subscription** in one transaction | Not mounted (404) |
| `/api/super-admin/*` | Mounted (super-admin gated) | Not mounted (404) |
| First-run bootstrap | n/a | With an empty DB, create org + admin from `IDENTO_ADMIN_EMAIL` / `IDENTO_ADMIN_PASSWORD`; flow disabled once an admin exists |
| Plan seeds (migration `000009`) | Free/Starter/Pro/Enterprise | Single internal "Unlimited" plan + subscription for the bootstrap tenant |
| Limits enforcement | Active | Same code path; Unlimited plan's `-1` limits always pass — **no mode branching inside `CheckTenantLimit`** |
| New users | Self-serve via registration; invited within org | Invitation only |
| Frontend | `GET /api/instance` returns `{mode, version}`; web hides registration and super-admin UI in `onprem` | same endpoint |

**On-prem licensing in v1 is contractual** — no key validation, no activation, no phone-home. `GET /api/instance` reserves a `license` field for a future entitlement mechanism.

Seeding note: migration `000009`'s plan seeds move out of the migration into mode-aware startup seeding, so the migration chain stays identical in both modes.

## 3. Foundation Work (shared by both editions, done first)

1. **Tenant isolation moves into the store layer.** Scoped store methods (`GetEventByIDForTenant(ctx, id, tenantID)` etc.) replace handler-level comparisons; `requireEventOwnership` (`backend/internal/handler/authz.go`) remains the single handler-side path. The **JWT claim is the only source of the active tenant** — remove remaining uses of `users.tenant_id` in authorization checks (QR-token and staff-assign paths in `users.go`). Postgres RLS is deliberately deferred: the application is the only DB client; RLS is a later defense-in-depth layer.
2. **Config package.** One `backend/internal/config` struct, validated at startup: `DATABASE_URL`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `PORT`, `DEPLOYMENT_MODE`, `IDENTO_ADMIN_*`. Removes scattered `os.Getenv` calls and the cwd-dependent `../.env` godotenv load in `main.go`.
3. **Embedded migrations** via `go:embed`; the binary becomes self-contained. Delete the committed `backend/idento-backend` binary from the repo.
4. **Docker.** Multi-stage Dockerfile for the backend (distroless runtime) and for web (nginx static). `docker-compose.prod.yml`: backend + web + postgres. Drop Redis (unused) and pgAdmin from anything production-facing.
5. **Release engineering.** Tag-triggered GitHub Actions workflow: semver tags build and push images to GHCR and attach binaries/bundles to a GitHub Release. Add `GET /api/version` (and include version in `/api/instance`).

## 4. SaaS Phase (ships first)

- **Onboarding fix (P0 bug).** `Register` creates tenant + subscription to the default plan transactionally. Add `is_default` (and configurable trial length) to `subscription_plans`. Backfill migration creates subscriptions for existing tenants that lack one.
- **Working suspension.** Middleware after JWT validation enforces the tenant lifecycle status (`suspended` — see tenant CRUD below; subscription `status` stays billing-only) and subscription expiry (`expired`/`cancelled` past `end_date`), with a short-TTL in-memory cache (~2 min) to avoid a DB hit per request. Suspended tenants get 403 `{"code": "tenant_suspended"}` on all tenant routes except reading their billing status. Mobile and kiosk clients must surface this as "organization suspended", not a generic network error.
- **Fix the attendee limit.** Count attendees for the target event at creation/bulk-import time (replaces the `current = 0` stub in `CheckTenantLimit`).
- **Impersonation.** `POST /api/super-admin/tenants/:id/impersonate` mints a short-lived JWT (30 min TTL) with `imp_by=<superAdminUserID>` and admin role in the target tenant. No refresh for impersonation tokens; no nested impersonation. Every mutating request with `imp_by` set is written to `admin_audit_log`. Web shows a persistent banner "You are in <org> as support" with an exit action.
- **Platform analytics.** Replace the "coming soon" stub (`handler/super_admin.go`) with SQL aggregates: tenants by status/plan, weekly signups, active events, check-ins per day, trial→paid conversion. No external BI.
- **Audit log completion.** Populate `ip_address`/`user_agent` (currently always NULL); add tenant-lifecycle and impersonation event types.
- **Tenant CRUD for operators.** Create org manually, suspend/reactivate, archive (soft-delete with a retention policy). "Suspend" becomes a real lifecycle state rather than a subscription-status side effect.
- **Tenant-management admin UI** per the design brief in `docs/design-briefs/saas-tenant-admin.md`.

## 5. On-Prem Phase (second)

Deliverable: a versioned bundle `idento-onprem-vX.Y.Z.tar.gz` containing `docker-compose.yml`, `.env.example`, `INSTALL.md`, and a Postgres backup/restore script. Upgrade path: `docker compose pull && docker compose up -d` (migrations auto-run at startup, already the case). Registration disabled, bootstrap admin, Unlimited seed — all from §2. Kiosk, mobile, and the printer agent already support configurable server URLs and work against on-prem unchanged. Documentation set: install, upgrade, backup/restore, system requirements.

## 6. Security & Error Handling

- Impersonation is the most sensitive new surface: distinct token type, short TTL, full audit trail, visible banner, no cascading impersonation.
- Suspension returns a machine-readable code so every client (web, mobile, kiosk) can present it honestly.
- On-prem bootstrap credentials are single-use: once an admin exists, the bootstrap path is dead code at runtime.
- Registration in `saas` mode remains open; rate limiting on auth endpoints is assumed to remain as-is (already hardened in Phase 2B security work).

## 7. Testing

- **Isolation suite (highest value):** table-driven tests per scoped store method asserting tenant B cannot read/mutate tenant A's resources.
- **Onboarding:** register → create event succeeds with no manual DB intervention.
- **Suspension:** suspended tenant receives 403 with `tenant_suspended` on mutations.
- **Mode matrix:** integration tests assert `/auth/register` and `/api/super-admin/*` are unmounted in `onprem`; CI runs the test suite in both modes.

## 8. Deliverables of This Design

1. This spec — `docs/superpowers/specs/2026-07-10-saas-onprem-distribution-design.md`
2. Rework roadmap with concrete work items — `docs/DUAL_DISTRIBUTION_REWORK.md`
3. Tenant-management admin design brief — `docs/design-briefs/saas-tenant-admin.md`

## Out of Scope

Payment provider integration (Stripe/YooKassa — post-v1), Postgres RLS, license key enforcement/activation for on-prem, Helm/Kubernetes packaging, SMTP/email flows, migrating font storage out of Postgres, multi-tenant on-prem edition.
