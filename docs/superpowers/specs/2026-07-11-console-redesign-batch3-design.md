# Platform Console Redesign — Batch 3 (Audit Log + Plans Editor) — Design

- **Date:** 2026-07-11
- **Status:** approved by user, pending implementation plan
- **Depends on:** Batch 2 (merged, PR #35, commit `7414c75`) — `AuditEntryList` component + `groupAuditLogByDay`/`formatAuditDiff` utilities (built specifically for reuse here), `GetAuditLog`'s `target_id`/`action` filters, the tenant-scoped audit-logging conventions.
- **Source design brief:** `docs/design-briefs/saas-tenant-admin.md` (deliverables #5 Plans editor, #6 Audit log).

## Goal

Replace the flat, ungrouped `AuditLog.tsx` table with a filterable (actor/action/tenant/date), paginated, human-readable-diff view built on Batch 2's `AuditEntryList`. Replace `SubscriptionPlans.tsx`'s plain number inputs for limits with an explicit "Unlimited" toggle, closing the brief's "make `-1` human" ask. Impersonation session-grouping (collapsing an `impersonate_tenant` row with its `impersonated_request` children) is explicitly **out of scope**, deferred to a later pass.

## Key decisions (confirmed with user)

1. **Actor filter is a fixed dropdown**, not search-as-you-type — populated from the existing cross-tenant super-admin user list (`GetAllUsersSuper`, filtered client-side to `is_super_admin === true`). No new backend endpoint; matches the brief's "handful of internal operators" framing.
2. **Date filter uses two native `<input type="date">` fields** (from/to), not a calendar-picker component — none exists in this codebase yet, and adding one is out of proportion to this batch. Requires a backend date-range filter on `GetAuditLog`.
3. **Tenant filter reuses the existing full-tenant-list-fetch + client-side-search convention** (same as `Organizations.tsx`'s saved-queue/search pattern) via a `Command` combobox (already an installed shadcn primitive, `web/src/components/ui/command.tsx`, currently unused) — not a new paginated tenant-search endpoint.
4. **Real server-side pagination for Audit Log** (Previous/Next wired to `total`/`offset`), unlike the Tenants list's client-side-only pagination — the audit log is the one surface explicitly called out in the brief as needing to handle unbounded growth, and `GetAuditLog` already returns `total`.
5. **Plans editor keeps its current fixed 3-limits/3-features shape** — no dynamic/arbitrary-key field support. Only adds the Unlimited toggle.
6. **Impersonation session-grouping deferred** — flat day-grouped entries (via `AuditEntryList`, unmodified) ship this batch; the collapse/expand-by-session UI is real added complexity better scoped as its own follow-up.

## Design

### Backend changes

**1. `GetAuditLog` — add `admin_user_id` filter.** Same shape as the existing `target_id` filter: optional query param, parsed as UUID, silently ignored if invalid/absent (never a `400`), ANDed into the WHERE clause alongside `action`/`target_id`.

**2. `GetAuditLog` — add `date_from`/`date_to` filter.** Optional query params (`YYYY-MM-DD`), inclusive range on `created_at` (`date_from` = start of day, `date_to` = end of day, both in UTC — the frontend's native date inputs are timezone-naive, so treating them as UTC-day boundaries is the simplest correct contract). Invalid/malformed dates are silently ignored, same tolerance as the other filters.

**3. `UpdateSubscriptionPlanSuper` — capture old/new diff.** Currently logs `changes: {"plan": <new state>}` only. Fetch the existing plan before applying the update — `Store.GetSubscriptionPlanByID(ctx, id) (*models.SubscriptionPlan, error)` already exists (`backend/internal/store/pg_store.go:1245`) — and log `changes: {"old": oldPlan, "new": newPlan}`, matching `UpdateTenantSubscription`'s established shape. `CreateSubscriptionPlan`'s logging is unchanged (`{"plan": plan}` is already sufficient for a creation event — there's no "old" state).

No new tables, no migration — filter/logging surface on top of existing structures.

### Frontend architecture

**`auditFormat.ts` — extend `formatAuditDiff`'s switch, add two cases:**
- `create_plan` → `"Plan created: {name}"`.
- `update_plan` → same field-level diff-parts pattern already used for `update_subscription`/`create_subscription` (compare `old`/`new` on `name`, `price_monthly`, `price_yearly`, `is_active`, `is_public`, plus a generic "Limits updated"/"Features updated" line if either JSON-stringified object differs), falling back to `"Plan updated"` if nothing in the tracked fields changed.

`AuditEntryList` itself is **not modified** — same component, same props, reused a third time (after Batch 2's Subscription-history and Activity-tab call sites).

**Audit Log page (`AuditLog.tsx`) rebuilt:**
- Filter row: Action `Select` (existing `KNOWN_ACTIONS` list, unchanged), Actor `Select` (new — populated from `GetAllUsersSuper` filtered to super-admins), Tenant `Command` combobox (new — searches the existing full-tenant-list fetch by name, selecting sets `target_id`), Date-from/Date-to `Input[type=date]` (new).
- Body: `AuditEntryList` fed by the filtered/paginated fetch (replacing the old flat `<Table>`).
- Footer: Previous/Next pagination controls wired to `offset`/`limit`/`total` from the response, matching the numeric contract `GetAuditLog` already returns.
- All filters compose into one query (action AND actor AND tenant AND date-range), matching the backend's AND-chain filter design.

**Plans editor (`SubscriptionPlans.tsx`) — Unlimited toggle only:**
- Each of the three limit fields (`events_per_month`, `attendees_per_event`, `users`) gets a paired `Switch` (existing primitive) labeled "Unlimited" beside its `Input[type=number]`. Toggling on sets the limit's value to `-1` and disables the number input; toggling off restores a sane default (e.g. the last non–`-1` value, or `0` if none) and re-enables the input. On load, a limit value of `-1` initializes its toggle to on.
- No other changes to the create/edit dialog, card grid, or feature toggles.

### Data flow summary

```
Audit Log page load / filter change
  → GET /audit-log?action=&admin_user_id=&target_id=&date_from=&date_to=&limit=&offset=

Actor filter dropdown populated once  → GET /users (no tenant_id, cross-tenant; filtered client-side to is_super_admin)
Tenant filter combobox populated once → GET /tenants (existing, already fetched unpaginated elsewhere)

Plans editor save (create) → POST /plans        (unchanged logging: {"plan": plan})
Plans editor save (edit)   → PUT /plans/:id      (changed logging: {"old": ..., "new": ...})
```

### Error handling

No new error classes. New filter params follow the existing tolerant-of-invalid-input convention (ignored, not `400`) since they're UI-controlled, not user-typed free text in a way that needs validation feedback.

## Testing

- **Backend (Go):** table-driven tests for the `admin_user_id` and `date_from`/`date_to` filters on `GetAuditLog` (combinable with existing filters, invalid values tolerated); a test asserting `UpdateSubscriptionPlanSuper` logs `old`/`new` instead of the current `{"plan": ...}` shape.
- **Frontend (Vitest + RTL):** `formatAuditDiff`'s two new action cases; the rebuilt Audit Log page's filter-composition (each filter narrows the query correctly) and pagination controls; the Plans editor's Unlimited toggle (sets/clears `-1`, disables/enables the input, initializes correctly from a `-1` value on load).
- **Manual/live-browser click-through** (established pattern): filter combinations, pagination Prev/Next, Unlimited toggle round-trip, in both light/dark and EN/RU, before merge.

## Out of scope

- Impersonation session-grouping (collapse/expand by session) — deferred, real future work.
- Dynamic/arbitrary limit or feature keys in the Plans editor — fixed set only.
- A calendar/date-range-picker component — native date inputs instead.
- Plan deletion/archival UI — matches current behavior (create/edit only, no delete endpoint exists).

## Risks

| Risk | Mitigation |
|---|---|
| `date_from`/`date_to` treated as UTC-day boundaries while the operator's browser is in a different timezone could make the range feel off-by-one near midnight | Documented as a known, accepted characteristic (native date inputs are inherently timezone-naive); not worth a calendar-component investment for this batch. |
| Retargeting `UpdateSubscriptionPlanSuper`'s audit shape from `{"plan": ...}` to `{"old", "new"}` could break something reading the old shape | Grep-verify before landing, same check Batch 2 did for the analogous subscription-audit retarget. |
| Actor-filter dropdown fetches the full cross-tenant user list even though only super-admins are shown | Acceptable — same-order-of-magnitude fetch as the existing All Users page already does; no pagination needed at "handful of operators" scale. |

## Next steps

Write the task-by-task implementation plan (`writing-plans` skill) under `docs/superpowers/plans/2026-07-11-console-redesign-batch3.md`, following Batches 1–2's plan structure, then execute via `subagent-driven-development`.
