# Tenant Archival Retention & Purge — Design

**Date:** 2026-07-13
**Status:** Approved by owner
**Closes the gap:** the Dual Distribution design (§4 tenant lifecycle) and roadmap item P1.4 specify tenant archival as "soft-delete with a retention policy". The shipped implementation only flips `tenants.status` to `'archived'` — no `archived_at` timestamp, no retention configuration, no purge. This spec adds the missing retention half.

## Product decisions (confirmed with owner, 2026-07-13)

| Decision | Choice |
|---|---|
| Default retention | **90 days** after archival |
| Deployment modes | **Both SaaS and on-prem**, one config value; `0` disables auto-purge |
| Purge scope | **Full tenant cascade delete**; platform `admin_audit_log` entries are the permanent record |
| Mechanism | **Daily ticker goroutine** in the server process, guarded by config |
| Reactivation | Archived tenants are reactivatable **until purged** ("within retention" ≡ "row still exists") |

## 1. Migration `000017_tenant_archival_retention`

Up:

- `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;`
- Backfill: `UPDATE tenants SET archived_at = NOW() WHERE status = 'archived' AND archived_at IS NULL;` — the archival time of pre-existing archived tenants is unknown, so their retention clock starts at deploy time (conservative: they get a full window).
- `CREATE INDEX IF NOT EXISTS idx_tenants_archived_at ON tenants(archived_at) WHERE status = 'archived';` — cheap purge scan.
- `ALTER TABLE admin_audit_log ALTER COLUMN admin_user_id DROP NOT NULL;` — system-initiated purges have no admin actor. The audit list query does not join `users`, so the only code ripple is `models.AdminAuditLog.AdminUserID` becoming `*uuid.UUID`.

Down: restore `NOT NULL` (after deleting NULL-actor rows), drop index and column.

## 2. Configuration

`backend/internal/config/config.go` gains:

- `TenantRetentionDays int`, read from `TENANT_RETENTION_DAYS`.
- Unset → default **90**. `0` → auto-purge disabled. Negative or non-numeric → startup error (fail fast, consistent with existing validation style).
- Identical semantics in `saas` and `onprem` modes.
- Documented in `.env.example` and the on-prem deployment docs.

## 3. Lifecycle semantics

- **Store** ([pg_store.go](../../../backend/internal/store/pg_store.go) `UpdateTenantStatus`): SQL becomes
  `UPDATE tenants SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = $1`.
  One method, no interface change: archive stamps the clock, reactivate (and any other transition) clears it.
- **Transitions** ([super_admin.go](../../../backend/internal/handler/super_admin.go) `tenantTransitions`): `reactivate` accepts **`suspended` or `archived`** as the source state (today `archived` is terminal, contradicting the soft-delete intent). `suspend` (`active→suspended`) and `archive` (`suspended→archived`) are unchanged. No retention-date check on reactivate: if the row still exists, it is within retention by definition.
- **Model**: `models.Tenant` gains `ArchivedAt *time.Time \`json:"archived_at,omitempty"\`` and super-admin tenant list/detail queries select it, so operators can see the purge clock.

## 4. Purge worker

A goroutine started from `main.go` after handler initialization, only when `cfg.TenantRetentionDays > 0`. First pass ~1 minute after startup (lets the server settle), then every 24 h. The backend has no background jobs today; this is deliberately the smallest possible one — no scheduler dependency, no shutdown wiring (process exit kills the ticker, consistent with `e.Logger.Fatal(e.Start(...))`).

Each pass calls a single new store method:

```go
PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]PurgedTenant, error)
```

which selects tenants `WHERE status = 'archived' AND archived_at < NOW() - make_interval(days => $1)` and, **per tenant, in one transaction**:

1. **Detach shared users**: `UPDATE users SET tenant_id = NULL WHERE tenant_id = $tenant AND (is_super_admin OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = users.id AND ut.tenant_id <> $tenant))`.
   Without this, the cascade would hard-delete a multi-org user together with their *other* orgs' memberships, and a tenant-homed promoted super admin would abort the whole delete via the `admin_audit_log.admin_user_id` FK. Their `user_tenants` row for the purged tenant still cascades away.
2. **Delete the tenant**: `DELETE FROM tenants WHERE id = $tenant` — existing `ON DELETE CASCADE` FKs remove users, events, attendees, check-ins, subscriptions, usage logs, org memberships, API keys, fonts, zones, stations.
3. **Audit**: insert a `purge_tenant` entry with `admin_user_id = NULL`, `target_type = 'tenant'`, `target_id = $tenant`, `changes = {name, archived_at, retention_days}` — the permanent record that survives the purge.

A failure on one tenant is logged and skipped; the pass continues with the rest. The worker logs one summary line per pass that purged at least one tenant or hit an error; idle passes are silent.

## 5. Testing

Follow the fake-store patterns in [super_admin_lifecycle_test.go](../../../backend/internal/handler/super_admin_lifecycle_test.go):

- **Handler**: reactivate from `archived` → 200 and `UpdateTenantStatus(id, "active")`; reactivate from `active` still 409; archive from `suspended` unchanged.
- **Worker**: retention 0 → store never called; expired tenants → purge invoked with configured days; store error → logged, worker survives.
- **Config**: unset → 90; explicit value honored; `0` accepted; negative/garbage → `Load` error.
- **Store**: `pgxmock` tests (the store convention, e.g. `pg_store_hasanyusers_test.go`) asserting the `UpdateTenantStatus` CASE SQL and the `PurgeExpiredTenants` select→detach→delete→audit transaction flow, including rollback on mid-transaction error.

## Alternatives considered

- **Granular store methods** (list-expired / detach / delete as separate interface methods with orchestration in the worker): more interface and fake-store surface for no benefit; the single-method transaction matches the thin-store style used elsewhere.
- **`pg_cron` / DB-side scheduling**: rejected — the extension cannot be assumed on on-prem Postgres.
- **Manual `cmd/purge_tenants` CLI only**: rejected by owner in favor of the ticker; may be added later if on-prem operators ask for explicit control.
