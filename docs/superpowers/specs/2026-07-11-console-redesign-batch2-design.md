# Platform Console Redesign — Batch 2 (Tenant Detail Workbench) — Design

- **Date:** 2026-07-11
- **Status:** approved by user, pending implementation plan
- **Depends on:** Batch 1 (merged, PR #32, commit `fff116d`) — dark-chrome shell, `StatusBadge`, `meterTone`/`meterToneClass`, `Sheet` primitive (unused until now), design tokens, `reason` field already wired into `setTenantStatus` (suspend/reactivate/archive) and `ImpersonateTenant`.
- **Source design brief:** `docs/design-briefs/saas-tenant-admin.md` (deliverables #3 Tenant detail workbench, #4 Impersonation ceremony).
- **Source visual reference:** Claude Design project `165a9ba5-4bb1-4ede-9048-546ccb1742af`, file `Idento Console.dc.html` (same canonical source Batch 1 used).

## Goal

Replace the plain-Card `OrganizationDetail.tsx` with the design brief's "workbench": a persistent tenant identity header, five stacked sections navigable via a sticky anchor rail, a lifecycle state timeline instead of a status dropdown, and a ceremonial (not incidental) impersonation entry/exit flow. Audit Log and Plans editor reskins are explicitly **out of scope** — they are independent screens with no code overlap with this work and are deferred to Batch 3.

## Scope decomposition (why this slice)

The full "Batch 2" scope named in prior planning notes covered five items: Tenant Detail, Suspend/Archive dialogs, Impersonation ceremony, Audit Log reskin, Plans editor reskin. These split into two groups:

- **The workbench trio** (this spec): Tenant Detail, Suspend/Archive dialogs, Impersonation ceremony. All three live on or are entered from the same page, share the `reason`-field pattern, and share the new tenant-scoped audit feed described below.
- **Independent screens** (Batch 3, separate spec): Audit Log reskin, Plans editor reskin. No shared code with the trio beyond already-shipped primitives (`StatusBadge`, design tokens).

## Key decisions (confirmed with user)

1. **Live consequence copy in Suspend/Archive dialogs** uses only existing aggregate counts (`users_count`, `events_count`, `attendees_count` from `GetTenantStats`) — e.g. "This affects 4 users and 2 events." No new backend query for "event X is running today"; that literal brief example is not built. (Consistent with Batch 1's own "no fabricated data" constraint.)
2. **Users tab has no "last login" column.** No login-timestamp is tracked anywhere in the backend. The tab ships with name/email/role/joined-date only; last-login is documented as a known backend gap in the batch summary, same treatment Batch 1 gave the `isOverLimit` scope-mismatch limitation.
3. **Tenant-scoped audit filtering is added server-side** (`target_id` query param on `GetAuditLog`) rather than fetching the full log and filtering client-side in the browser, because the brief explicitly requires designing for an unboundedly-growing audit log.
4. **Impersonation exit summary shows duration + action count** ("You were in Acme Corp for 12 min, made 4 changes"), derived from the tenant-scoped audit feed between the `impersonate_tenant` mint and now, with a link into that filtered view — not a bare confirmation toast.
5. **`reason` field mandatory for:** impersonation entry, subscription changes (brief says both explicitly "not optional"). **Optional for:** suspend/reactivate/archive, where the per-checkbox acknowledgment carries the guardrail instead. This is an extension of Batch 1's existing optional-`reason` backend fields, not a change to them — suspend/archive/reactivate stay optional; only the new subscription-change `reason` is mandatory, and impersonation's existing optional field becomes mandatory at the frontend+backend validation level.

## Design

### Backend changes

**1. `UpdateTenantSubscription` (`backend/internal/handler/super_admin.go`) — two changes:**
- Accept an optional `reason` field on the request body; when absent/empty, return `400` (mandatory, unlike the lifecycle endpoints).
- Re-target its `LogAdminAction` call from `target_type="subscription", target_id=<sub.ID>` to `target_type="tenant", target_id=<tenantID>` (matching the convention already used by `setTenantStatus`/`ImpersonateTenant`), keeping the existing `old`/`new` diff plus the new `reason` in the `changes` payload. This is what makes subscription changes visible to the tenant-scoped audit filter below — without it, the Activity tab and Subscription change-feed would silently miss every subscription edit.

**2. `ImpersonateTenant` — `reason` becomes mandatory** (`400` if empty), tightening the field Batch 1 already added as optional.

**3. `GetAuditLog` — add a `target_id` query param filter**, alongside the existing `action` filter (both remain optional and combinable). Reused by:
   - Tenant Detail's Activity section (`target_id=<tenantID>`, no action filter → everything that happened to this tenant).
   - The Subscription tab's change feed (`target_id=<tenantID>&action=update_subscription`).
   - The impersonation exit summary's action count (`target_id=<tenantID>` rows between mint time and now, filtered client-side to this admin's `admin_user_id`).

No new tables, no new migration — this is filter/target-scoping surface on top of the existing `audit_log` table and `LogAdminAction` call sites.

### Frontend architecture

**Tenant Detail layout.** Single-page long-scroll, not tabs and not nested routes: a sticky left anchor rail with five links (Summary / Subscription & Limits / Lifecycle / Users / Activity), active section tracked via `IntersectionObserver` and reflected in the URL hash so a section is directly linkable (e.g. from an audit log entry, in Batch 3). Chosen over nested routes because this is one workbench, not five separate views, and the brief calls for a persistent tenant identity header spanning all of them — routing per section would fragment that. Chosen over tabs because the brief explicitly asks for "stacked sections," and a long-scroll keeps adjacent context (e.g. current plan while reading Lifecycle) visible without a click.

**Persistent tenant identity header.** Name + `StatusBadge` + plan badge, pinned above the rail, present on every section — reuses Batch 1's `StatusBadge` and design tokens, no new primitive.

**Lifecycle timeline.** A small horizontal state indicator (active → suspended → archived) replacing the current bare action buttons, plus the transition actions themselves:
- **Suspend** → `Dialog` (modal): per-checkbox acknowledgment list (e.g. "I understand this blocks all API access for this tenant's users"), live-consequence line from `GetTenantStats` counts, optional reason textarea, typed-confirm-tenant-name gate (reusing `ConfirmActionDialog`'s existing fail-closed logic — not modified, only composed).
- **Archive** → `Sheet` (right side-sheet, Batch 1's unused primitive) — same acknowledgment-checkbox + typed-confirm pattern as Suspend, given more visual room specifically to explain the retention countdown archive starts, which needs more than a modal's usual copy budget.
- **Reactivate** stays a simple confirm (no checkboxes, non-destructive), matching current behavior.

**Subscription & Limits tab.** Keeps the existing plan/status/custom-limits/admin-notes form fields, adds the new mandatory reason field on save, and appends a compact append-only change-feed list below the form — sourced from `GET /audit-log?target_id=<tenantID>&action=update_subscription,create_subscription`, rendered as human-readable diffs ("Plan: Starter → Professional; reason: invoice #1042").

**Users tab.** Table from the existing `GetAllUsersSuper(tenant_id=<id>)` endpoint (already supports this filter, unused by any UI today) — name, email, role, joined date.

**Activity tab.** Tenant-scoped audit feed, day-grouped, action-badged, human-readable diffs. Built as a standalone `AuditEntryList` component (props: `entries`, no fetching of its own) specifically so Batch 3's Audit Log page can reuse it for the global view rather than duplicating rendering logic — this batch only wires it into the tenant-scoped fetch.

**Impersonation ceremony.**
- Entry: replace the current bare `ConfirmActionDialog` usage with a dialog carrying a mandatory reason textarea (submit disabled until non-empty) — everything else about the dialog (typed-confirm, busy state) is unchanged.
- Banner (`ImpersonationBanner.tsx`): no changes — its amber tone and countdown already match the brief.
- Exit: when `endImpersonation` fires, show a summary (toast or small panel) computed from `GET /audit-log?target_id=<tenantID>` rows between the impersonation's mint timestamp and now, filtered to `action=impersonated_request` for this admin — "You were in {tenant} for {duration}, made {count} changes," linking to that filtered Activity view.

### Data flow summary

```
Tenant Detail page load
  → GET /tenants/:id/stats           (existing, unchanged)
  → GET /plans                        (existing, unchanged — for the plan selector)
  → GET /users?tenant_id=:id          (existing, unused-until-now filter)
  → GET /audit-log?target_id=:id      (new filter — feeds both Activity tab and Subscription change-feed)

Suspend/Archive/Reactivate  → POST /tenants/:id/{suspend,archive,reactivate}   (existing, reason optional, unchanged)
Subscription save           → PATCH /tenants/:id/subscription                 (reason now required; audit re-targeted to tenant)
Impersonation entry         → POST /tenants/:id/impersonate                   (reason now required)
Impersonation exit          → GET /audit-log?target_id=:id (client-side, for the summary only — no new endpoint)
```

### Error handling

No new error classes. Mandatory-field validation (reason on subscription/impersonation) is enforced both client-side (submit button disabled) and server-side (`400` on empty), matching the existing pattern for tenant-name-required checks elsewhere in this codebase. `GetAuditLog`'s new `target_id` param follows the same "invalid → ignored, not 400" tolerance the existing `action` param has, since it's a UI-controlled value, not user-typed.

## Testing

- **Backend (Go):** table-driven tests for the retargeted subscription audit logging (asserts `target_type="tenant"`, `target_id=<tenantID>`, `changes["reason"]` present and required), `ImpersonateTenant` reason-required `400` path, and `GetAuditLog`'s new `target_id` filter (combinable with `action`, tolerant of invalid/absent values) — following `super_admin_test.go`'s existing `fakeStore` convention.
- **Frontend (Vitest + RTL):** anchor-rail `IntersectionObserver` section tracking, Suspend/Archive checkbox-gated confirm buttons (mirroring `ConfirmActionDialog`'s existing fail-closed tests — not re-testing that component, only the new composition), mandatory-reason blocking submit on impersonation entry and subscription save, `AuditEntryList` diff-rendering and day-grouping.
- **Manual/live-browser click-through** (this session's established pattern): full Tenant Detail scroll-spy, Suspend → Archive → Reactivate cycle, impersonate → act → exit-with-summary, in both light/dark and EN/RU, before merge.

## Out of scope

- Audit Log page reskin, Plans editor reskin (Batch 3).
- Last-login tracking (backend gap, documented not fixed).
- Literal "named event running today" live-consequence text (backend gap, documented not fixed — counts-only instead).
- Any change to `ConfirmActionDialog`'s fail-closed typed-confirm logic — composed, not modified (same hard rule Batch 1 used).
- Phase 2 on-prem packaging — unrelated track, not part of this initiative's console-redesign line.

## Risks

| Risk | Mitigation |
|---|---|
| Re-targeting subscription audit logging from `target_type=subscription` to `tenant` could break something reading the old shape | Grep confirmed no other code queries audit log by `target_type=subscription`; the `AllUsers`/analytics pages don't touch this table. Verify in the implementation plan before landing. |
| Anchor-rail `IntersectionObserver` scroll-spy is a new interaction pattern for this codebase | Keep it isolated to a small hook (`useScrollSpy` or similar), unit-testable in jsdom via a mocked `IntersectionObserver`, matching how Batch 1 tested its own new utilities. |
| Mandatory-reason UX friction on impersonation (support staff in a hurry) | Explicit product tradeoff from the design brief itself ("mandatory reason, not optional") — not a design flaw to fix here. |

## Next steps

Write the task-by-task implementation plan (`writing-plans` skill) under `docs/superpowers/plans/2026-07-11-console-redesign-batch2.md`, following Batch 1's plan structure (Global Constraints block, per-task Files/Interfaces/Steps), then execute via `subagent-driven-development`.
