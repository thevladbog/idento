# Design Brief: Idento Tenant-Management Admin (Internal SaaS Console)

**Date:** 2026-07-10
**Scope decided with product owner (v1):** tenant lifecycle, manual billing, impersonation, platform analytics.
**Depends on:** backend work P1.1–P1.7 in [DUAL_DISTRIBUTION_REWORK.md](../DUAL_DISTRIBUTION_REWORK.md).

## 1. Project Overview

**Product:** The internal operations console of Idento SaaS — where the platform team (not customers) manages tenants: provisions and suspends organizations, assigns subscription plans by hand (no payment provider in v1), enters customer accounts for support, and watches platform health. It exists today as the `/super-admin` section of the web app (SuperAdminLayout with Dashboard, Organizations, Organization Detail, All Users, Subscription Plans, Analytics, Audit Log), gated by an `is_super_admin` flag. This brief covers its redesign into a real operations tool as SaaS launches. It ships **only in SaaS mode** — on-prem installs never mount these routes.

**Users:** a handful of internal operators — founder(s), support, later a billing/ops person. This is a low-traffic, high-stakes surface: every action affects a paying customer, so the design optimizes for clarity, attributability, and guardrails over throughput or onboarding.

## 2. Context of Use

- **Support-driven sessions.** Most visits start from a customer conversation: "we can't create events", "extend our trial", "we paid — upgrade us". The operator arrives with a tenant name in mind; global tenant search is the front door.
- **Manual billing is a workflow, not a fallback.** With no payment provider in v1, every upgrade, trial extension, and custom limit is an operator action here. The console *is* the billing system; entries must be fast, reviewable, and annotated (who, why, reference to the invoice paid outside the system).
- **Actions are customer-visible and sometimes irreversible.** Suspending a tenant blocks their event tomorrow morning; archiving deletes data on a retention clock. Wrong-tenant mistakes must be structurally hard.

## 3. Core Objects & Information Architecture

The console has one center of gravity: the **tenant card**. Everything else is an entry point into it or an aggregate over all tenants.

- **Overview** — platform pulse (see §5, Analytics).
- **Tenants** (rename from "Organizations" for internal consistency) — searchable, filterable list: status (active / suspended / archived), plan, created date, usage snapshot (events, attendees, users), last activity. Filters mirror operator questions: "trials expiring this week", "suspended", "on custom limits".
- **Tenant detail** — the workbench, in tabs or stacked sections:
  1. *Summary*: status, plan, usage vs. limits (visual meters), key dates (created, trial ends, next billing), contacts, notes.
  2. *Subscription & limits*: plan assignment, trial extension, custom limits/features overrides, payment notes — every change requires a reason field that lands in the audit log.
  3. *Lifecycle*: suspend / reactivate / archive with typed-confirmation dialogs stating consequences ("Suspending blocks all API access for 4 users; their event 'X' is running today" — surface live context before the operator commits).
  4. *Users*: members of this tenant, roles, last login.
  5. *Activity*: usage log + audit entries scoped to this tenant.
  6. *Impersonate*: entry point with its own confirmation and reason field.
- **Plans** — CRUD for subscription tiers (JSON limits/features today; give them a form UI with explicit fields, `-1 = unlimited` made human: "Unlimited" toggle).
- **All Users** — cross-tenant user search (exists) — primarily a support lookup ("which org is this email in?").
- **Audit Log** — global, filterable by actor / action type / tenant / date; entries render human-readable diffs ("Plan: Starter → Professional; reason: invoice #1042").
- **Analytics** — see §5.

## 4. Key Design Problems to Solve

- **Wrong-tenant safety.** Every screen inside a tenant card carries a persistent tenant identity header (name, status chip, plan) — the operator must always know whose account they're touching. Destructive lifecycle actions use typed confirmation (retype tenant name) and show live consequences fetched at confirm time.
- **Impersonation as a ceremony, not a link.** Entering a customer account is the console's most sensitive action: a dedicated confirmation step with mandatory reason → new context opens with an unremovable banner ("You are in *Acme Corp* as support — 27 min left — Exit") → session expires after 30 minutes. The banner belongs to the *customer-facing* app's design system; this brief owns the entry/exit choreography and the audit trail rendering.
- **Manual billing that doesn't rot.** Freeform plan overrides accumulate into unexplainable state. Design the subscription tab as an append-only history ("changes" feed) on top of current state, so any tenant's billing story is reconstructible: what changed, when, by whom, why. The reason field is mandatory, not optional.
- **Status is a lifecycle, not a dropdown.** Active → suspended → reactivated → archived are transitions with rules (archive only from suspended; archive starts a retention countdown shown on the card). Render as a state timeline, not an editable select.
- **Trial pressure at a glance.** With manual billing, revenue depends on operators noticing expiring trials. The Overview and Tenants list must surface "trials ending soon" and "over limit" as first-class queues, not buried filters.

## 5. Analytics (v1)

Replace the current stub with operational aggregates, all server-side SQL (no external BI): tenants by status and plan, signups per week, trial→paid conversion, active events now, check-ins per day (platform-wide), top tenants by usage. Design principle: every number links to the filtered tenant list behind it. Charts follow the platform dataviz conventions (brand-consistent, dark/light).

## 6. Visual Identity

- **Distinct console signature.** Operators switch between the customer-facing admin and this console; make the context unmistakable — inverted top chrome (dark header in light theme) or a persistent colored console rail, plus a "Platform console" label. Same token system as the rest of Idento (green `hsl(152 100% 29%)`, shadcn variables, 0.5rem radius), but the accent for destructive lifecycle actions leans on the brand red family.
- **Density:** compact by default — this is an expert tool; tables, meters, and status chips over cards and hero numbers.
- **Status language:** one chip vocabulary shared across list, detail, and audit: active (green), trial (blue), suspended (amber), archived (gray), over-limit (red outline).
- **Themes:** light + dark, consistent with the platform.
- **Language:** the console ships EN-first (internal tool); i18n keys still used (the codebase is fully keyed) so RU can follow.

## 7. Technical & UX Constraints

- Lives inside the existing web app (React 18 + Tailwind v4 + shadcn/ui) under `/super-admin` with `SuperAdminLayout`; designs compose from the existing primitive set plus tabs/data-table patterns shared with the main panel brief.
- Backend contracts from the rework roadmap: tenant lifecycle endpoints (P1.4), impersonation (P1.5), analytics aggregates (P1.6), audit log with IP/UA (P1.7), subscription upsert fix (P0.1). Design nothing that requires endpoints outside that set.
- Access: `is_super_admin` is checked against the DB per request (already the case) — UI can assume revocation is immediate; no client-side role caching.
- All lists paginate server-side (All Users already does); audit log will grow unboundedly — design for it.
- Accessibility: WCAG AA; destructive dialogs fully keyboard-operable; chip colors never the sole status carrier.

## 8. Success Metrics

- Support request → resolved tenant action (upgrade, unsuspend, trial extension) in under 2 minutes from console open.
- Zero wrong-tenant incidents; 100% of subscription changes carry a reason.
- Every impersonation session attributable end-to-end in the audit log.
- Trials expiring within 7 days are visible on the Overview without any filtering.

## 9. Deliverables

1. Overview page with operational queues (trials expiring, over-limit, recently suspended) + analytics modules.
2. Tenants list with status/plan/usage columns, filters, and saved queues.
3. Tenant detail workbench: all six sections, including lifecycle timeline and typed-confirmation dialogs (with live-consequence content spec).
4. Impersonation ceremony: entry dialog, in-app banner spec (for the customer-facing app), exit flow, audit rendering.
5. Plans editor with explicit limit/feature fields.
6. Audit log list with human-readable diff entries.
7. Component additions in both themes: status chips, usage meters, state timeline, append-only change feed.

## 10. Out of Scope

Payment provider UI (post-v1), customer-facing billing/upgrade pages, on-prem surfaces (console is SaaS-only), email notifications, the customer-facing admin redesign (covered by the SaaS panel brief).
