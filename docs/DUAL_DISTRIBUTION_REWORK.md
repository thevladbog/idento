# Dual Distribution Rework Roadmap (SaaS + On-Prem)

Companion to the approved design: [docs/superpowers/specs/2026-07-10-saas-onprem-distribution-design.md](superpowers/specs/2026-07-10-saas-onprem-distribution-design.md).

Work is ordered in three phases. Every item lists the affected files and an acceptance criterion. Items within a phase are roughly independent unless noted.

> **Status (2026-07-10): Phase 0 complete** — merged to main via [PR #23](https://github.com/thevladbog/idento/pull/23) (squash `b20311b`), all P0 acceptance criteria verified. Items P1.9–P1.10 below were added from Phase 0 review findings.

---

## Phase 0 — Foundation (shared by both editions) ✅ DONE (PR #23)

### P0.1 Fix broken SaaS onboarding (bug, blocks everything)
- **Problem:** `Register` (`backend/internal/handler/auth.go`) creates a tenant but no subscription; `store.CreateSubscription` is never called anywhere. `CheckTenantLimit` (`backend/internal/store/pg_store.go`) returns "no active subscription" → new orgs get 403 from `CheckLimits` middleware on any create.
- **Change:** create tenant + subscription transactionally in `Register`; add `is_default BOOLEAN` and trial-length config to `subscription_plans`; backfill migration for existing tenants without subscriptions. Also fix `UpdateTenantSubscription` (`backend/internal/handler/super_admin.go`) to upsert instead of 404 when no subscription row exists.
- **Accept:** fresh registration → create event/user/attendee succeeds with no manual SQL.

### P0.2 Move tenant isolation into the store layer
- **Problem:** store methods (`GetEventByID`, `GetAttendeeByID`, `UpdateAttendee` — `backend/internal/store/interface.go`) take only an id; ~10 handlers hand-roll `event.TenantID != claims.TenantID` (`events.go`, `attendees.go`). One forgotten check = cross-tenant leak. `GetEvent` (`events.go:82-91`) also lacks a nil guard.
- **Change:** introduce tenant-scoped store methods (`...ForTenant(ctx, id, tenantID)`), migrate handlers to them, keep `requireEventOwnership`/`requireZoneOwnership` (`handler/authz.go`) as the single handler-side helper. Remove authorization uses of `users.tenant_id` (QR-token issue at `users.go:130`, staff assign at `users.go:193`) — the JWT's active tenant is the only source of truth.
- **Accept:** isolation test suite (see P0.6) passes; no handler contains a raw `TenantID !=` comparison.

### P0.3 Config package
- **Problem:** scattered `os.Getenv` (`main.go`, `middleware/jwt.go`, `handler/auth.go`); godotenv loads `../.env` relative to cwd.
- **Change:** `backend/internal/config` struct validated at startup: `DATABASE_URL`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `PORT`, `DEPLOYMENT_MODE` (`saas|onprem`, default `onprem`), `IDENTO_ADMIN_EMAIL/PASSWORD`. Update `.env.example`.
- **Accept:** backend refuses to start with a clear message when required config is missing; no `os.Getenv` outside the config package.

### P0.4 Embedded migrations, drop committed binary
- **Problem:** `RunMigrations` (`pg_store.go`) reads `migrations/*.sql` from disk relative to cwd; a 15 MB prebuilt binary is committed at `backend/idento-backend`.
- **Change:** `go:embed` the migrations; delete the binary and gitignore build outputs; retire the duplicated logic in `backend/cmd/migrate` or point it at the embedded FS.
- **Accept:** the backend binary runs migrations from any working directory with no `migrations/` folder on disk.

### P0.5 Dockerfiles + production compose
- **Problem:** no Dockerfiles anywhere; `docker-compose.yml` is dev-only (postgres/redis/pgadmin); Redis is not used by the backend at all.
- **Change:** multi-stage `backend/Dockerfile` (distroless runtime), `web/Dockerfile` (nginx static build), `docker-compose.prod.yml` (backend, web, postgres, volumes, healthchecks). Remove Redis from compose or document it as dev-only tooling.
- **Accept:** `docker compose -f docker-compose.prod.yml up` serves a working system from clean state.

### P0.6 Isolation & mode test suites
- **Change:** table-driven cross-tenant tests for every scoped store method; integration tests for register→create-event; CI matrix running tests with `DEPLOYMENT_MODE=saas` and `onprem`.
- **Accept:** suites in CI; a deliberately unscoped store method fails the suite.

### P0.7 Release pipeline + version surface
- **Problem:** CI builds binaries and throws them away; no tags, no releases, no version endpoint.
- **Change:** tag-triggered workflow (semver) publishing GHCR images + GitHub Release artifacts; `GET /api/version`; `GET /api/instance` returning `{mode, version, license: null}`.
- **Accept:** pushing `v0.X.0` produces pullable images and a release page.

---

## Phase 1 — SaaS launch

### P1.1 Deployment-mode routing
- **Change:** in `handler/handler.go`, mount `/auth/register` and `/api/super-admin/*` only when `mode == saas`; move plan seeds out of migration `000009` into mode-aware startup seeding (SaaS: 4 tiers; on-prem: single "Unlimited" plan + subscription).
- **Accept:** `onprem` mode returns 404 on those routes; migration chain identical in both modes.

### P1.2 Enforced suspension & subscription expiry (builds on P1.4)
- **Change:** middleware after JWT validation checks the tenant lifecycle status from P1.4 (`suspended`) and subscription expiry (`expired`/`cancelled` past `end_date`) with a ~2-minute in-memory cache; 403 `{"code":"tenant_suspended"}` on all tenant routes except billing-status reads. Web, mobile, and kiosk handle the code explicitly.
- **Accept:** suspending a tenant blocks mutations within the cache TTL; clients show a human-readable state.

### P1.3 Fix attendee limit enforcement
- **Change:** `CheckTenantLimit` counts attendees for the target event (single and bulk paths); bulk import validates count before inserting.
- **Accept:** a plan with `attendees_per_event: 100` rejects the 101st attendee including via CSV import.

### P1.4 Tenant lifecycle for operators
- **Change:** tenant `status` (`active|suspended|archived`) as a first-class column; super-admin endpoints: create org, suspend/reactivate, archive (soft-delete + retention policy). Suspension here drives P1.2 (subscription status remains billing-only).
- **Accept:** lifecycle transitions audited and enforced at runtime.

### P1.5 Impersonation
- **Change:** `POST /api/super-admin/tenants/:id/impersonate` → 30-min JWT with `imp_by` claim, admin role in target tenant; refresh forbidden; no nested impersonation; all mutating requests with `imp_by` audit-logged; web shows a persistent banner with exit.
- **Accept:** support can reproduce a customer issue and every action is attributable in the audit log.

### P1.6 Platform analytics (replace stub)
- **Change:** implement `GET /api/super-admin/analytics` (`super_admin.go` — currently "Analytics coming soon"): tenants by status/plan, weekly signups, active events, check-ins/day, trial→paid conversion. SQL aggregates only.
- **Accept:** dashboard renders real numbers from a seeded dataset.

### P1.7 Audit log completion
- **Change:** populate `ip_address`/`user_agent` in `LogAdminAction`; add lifecycle + impersonation event types; index for filtering.
- **Accept:** audit entries carry actor, IP, UA, action, target, diff-friendly payload.

### P1.8 Tenant-management admin UI
- Per design brief: [docs/design-briefs/saas-tenant-admin.md](design-briefs/saas-tenant-admin.md).

### P1.9 Isolation sweep — remaining existence oracles (from Phase 0 final review)
- **Problem:** Phase 0 unified cross-tenant responses to 404 only for the migrated surface. `badge_zpl.go`, `attendee_codes.go` (two handlers), and `bulk_import.go` still return 403-for-foreign vs 404-for-missing — a cross-tenant existence oracle. Separately, `zones.go` `GetUserZoneAssignments` still authorizes via the target user's home `users.tenant_id` instead of active-tenant membership (`user_tenants`) — the same real bug class fixed in `users.go` during P0.2; multi-org staff get spurious 403s.
- **Change:** migrate those handlers onto `requireEventOwnership`/scoped getters; switch `GetUserZoneAssignments` to `GetUserTenantRole` against the caller's active tenant. Extend the isolation test suite to cover them.
- **Accept:** isolation suite covers every event/attendee-id-taking route; no handler distinguishes foreign from missing; no authz path reads `users.tenant_id`.

### P1.10 Registration atomicity + subscription upsert race (deferred from PR #23 review)
- **Problem:** (a) `Register` commits tenant+subscription before user creation — a failure in `CreateUser`/`AddUserToTenant` leaves an inert orphaned tenant (window predates Phase 0). (b) Concurrent super-admin subscription PATCHes for a subscription-less tenant race to insert; the loser 500s on `UNIQUE(tenant_id)` (data stays correct).
- **Change:** wrap the full registration flow (tenant, subscription, user, membership) in one transaction — new store method or tx-scoped store; make the upsert race-safe (`ON CONFLICT (tenant_id)` or reload-and-retry in the handler).
- **Accept:** killing the process mid-registration leaves no orphan rows; concurrent PATCH upserts both succeed (one create, one update).

---

## Phase 2 — On-prem packaging

### P2.1 Bootstrap flow
- **Change:** on `onprem` start with empty DB: create org + admin from `IDENTO_ADMIN_EMAIL/PASSWORD`; flow permanently disabled once an admin exists; invitation-only user creation afterwards.
- **Accept:** clean install reaches a working login without SQL; bootstrap env vars are inert on subsequent starts.

### P2.2 Frontend mode awareness
- **Change:** web reads `GET /api/instance`; hides registration and super-admin navigation in `onprem` (`web/src/pages/Register.tsx`, routing in `web/src/App.tsx`).
- **Accept:** on-prem build shows no self-signup or platform-admin surfaces.

### P2.3 Distribution bundle & docs
- **Change:** release artifact `idento-onprem-vX.Y.Z.tar.gz`: `docker-compose.yml`, `.env.example`, `INSTALL.md`, backup/restore script. Docs: install, upgrade (`docker compose pull && up -d`), backup/restore, system requirements.
- **Accept:** a fresh Linux host goes from tarball to working check-in following INSTALL.md only.

### P2.4 Client compatibility pass
- **Change:** verify kiosk/mobile/agent against an on-prem instance (server URL config already exists); document any assumptions.
- **Accept:** full check-in + badge print flow against an on-prem install.

---

## Explicitly deferred

Payment providers (Stripe/YooKassa), Postgres RLS, license keys/activation, Helm chart, SMTP/email, S3 font storage, multi-tenant on-prem edition.
