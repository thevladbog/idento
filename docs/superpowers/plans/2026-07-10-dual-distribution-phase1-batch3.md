# Dual Distribution Phase 1 — Batch 3 (P1.8 Tenant-Admin UI, Functional Increment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every Batch 1/2 operator capability into the existing super-admin UI: impersonation with the in-app banner, tenant lifecycle with typed confirmation, live analytics, filterable audit log with attribution — the FUNCTIONAL increment of P1.8 (the brief's full visual redesign is a later, mockup-first effort).

**Architecture:** React 18 + Vite + TS in `web/`, existing shadcn primitives (Table/Badge/Button/Dialog/Select/Input), axios client `@/lib/api`, react-i18next with inline EN/RU resources in `web/src/i18n.ts`. Impersonation is a client-side token swap: the operator token is parked in localStorage while the 30-min imp token becomes active; a persistent banner in the customer-facing `Layout` owns the countdown and exit.

**Tech Stack:** React 18, TypeScript, shadcn/ui, sonner (toasts), i18next. **No new npm dependencies** (no chart libs — analytics renders with stat cards and CSS bars).

## Global Constraints

- Gates before every commit: `cd web && npx tsc -b && npm run lint && npm run build` — all green.
- Every user-visible string is an i18n key with BOTH `en` and `ru` values in `web/src/i18n.ts` (inline `resources.en.translation` / `resources.ru.translation`).
- Backend endpoints consumed (all merged in main): `POST /api/super-admin/tenants`, `POST /api/super-admin/tenants/:id/{suspend|reactivate|archive}` (409 on invalid transition), `POST /api/super-admin/tenants/:id/impersonate` → `{token, expires_at, tenant_id}` (403 nested / 404 / 409 non-active), `GET /api/super-admin/analytics` (PlatformAnalytics shape), `GET /api/super-admin/audit-log?action=&limit=` → `{logs, total, ...}` with `ip_address`/`user_agent`.
- localStorage keys introduced: `operator_token`, `impersonation` (JSON `{tenantId, tenantName, expiresAt}`). Existing keys (`token`, `user`, `tenants`, `current_tenant`) keep their semantics.
- Wrong-tenant safety: destructive lifecycle actions (suspend/archive) require typing the tenant name; impersonation requires an explicit confirm dialog.
- Tenant status values: exactly `active` | `suspended` | `archived` (chip colors: green/amber/gray via Badge variants).
- Existing page structure/routes stay (this is an increment, not the redesign); new UI composes from existing `web/src/components/ui/*` primitives only.

## File Structure

```text
web/src/
├── lib/impersonation.ts                 (new)  — token swap start/end/read, expiry math
├── components/ImpersonationBanner.tsx   (new)  — persistent amber bar + countdown + exit
├── components/StatusBadge.tsx           (new)  — tenant lifecycle chip
├── components/ConfirmActionDialog.tsx   (new)  — generic confirm; optional type-to-confirm
├── components/Layout.tsx                (mod)  — banner mount (customer-facing chrome)
├── pages/super-admin/SuperAdminLayout.tsx (mod) — banner mount (operator chrome, safety net)
├── pages/super-admin/Organizations.tsx  (mod)  — status column+filter, create-tenant dialog
├── pages/super-admin/OrganizationDetail.tsx (mod) — status chip, lifecycle buttons, impersonate ceremony
├── pages/super-admin/Analytics.tsx      (mod)  — live aggregates
├── pages/super-admin/AuditLog.tsx       (mod)  — action filter + ip/ua columns
├── i18n.ts                              (mod)  — new keys EN/RU (each task adds its own)
```

Execution note: at execution start, commit this plan file to the feature branch. Tasks 2–3 depend on Task 1's module and Task 1½'s components; implement in order.

---

### Task 1: Impersonation session module + banner

**Files:**
- Create: `web/src/lib/impersonation.ts`, `web/src/components/ImpersonationBanner.tsx`
- Modify: `web/src/components/Layout.tsx` (mount above `<nav>`), `web/src/pages/super-admin/SuperAdminLayout.tsx` (same mount), `web/src/i18n.ts`

**Interfaces:**
- Produces (consumed by Task 2):

```ts
// lib/impersonation.ts
export type ImpersonationSession = { tenantId: string; tenantName: string; expiresAt: string };
export function startImpersonation(token: string, session: ImpersonationSession): void;
export function endImpersonation(): void;              // restores operator token, redirects to /super-admin/organizations
export function getImpersonation(): ImpersonationSession | null; // null when absent or expired (expired also cleans up)
```

- [ ] **Step 1: `web/src/lib/impersonation.ts`**

```ts
/**
 * Impersonation session plumbing (P1.8). The backend mints a 30-minute token
 * with an imp_by claim; the client parks the operator's own token and swaps
 * the active one. The banner (ImpersonationBanner) owns countdown + exit.
 */
export type ImpersonationSession = {
  tenantId: string;
  tenantName: string;
  expiresAt: string; // ISO from the mint response
};

const OPERATOR_TOKEN_KEY = 'operator_token';
const SESSION_KEY = 'impersonation';

export function startImpersonation(token: string, session: ImpersonationSession): void {
  const operatorToken = localStorage.getItem('token');
  if (operatorToken) {
    localStorage.setItem(OPERATOR_TOKEN_KEY, operatorToken);
  }
  localStorage.setItem('token', token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.location.href = '/dashboard';
}

export function endImpersonation(): void {
  const operatorToken = localStorage.getItem(OPERATOR_TOKEN_KEY);
  if (operatorToken) {
    localStorage.setItem('token', operatorToken);
  } else {
    localStorage.removeItem('token'); // fail safe: never keep the imp token
  }
  localStorage.removeItem(OPERATOR_TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  window.location.href = '/super-admin/organizations';
}

export function getImpersonation(): ImpersonationSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as ImpersonationSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      // Session lapsed: restore the operator silently on next read.
      endImpersonation();
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}
```

- [ ] **Step 2: `web/src/components/ImpersonationBanner.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { getImpersonation, endImpersonation } from '@/lib/impersonation';

/**
 * Unmissable support-session banner: shown on every page while an
 * impersonation token is active. Counts down and offers the only exit.
 */
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const [session, setSession] = useState(getImpersonation());
  const [minutesLeft, setMinutesLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const s = getImpersonation(); // self-cleans + redirects on expiry
      setSession(s);
      if (s) {
        setMinutesLeft(Math.max(0, Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 60000)));
      }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
      <span>
        {t('impersonationBanner', { tenant: session.tenantName, minutes: minutesLeft })}
      </span>
      <Button size="sm" variant="outline" className="h-7 border-black/30 bg-transparent text-black hover:bg-black/10" onClick={endImpersonation}>
        {t('impersonationExit')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Mount + i18n**

In `web/src/components/Layout.tsx`: import the banner and render `<ImpersonationBanner />` as the FIRST child inside the root `<div className="min-h-screen bg-background">`, above `<nav>`. Same one-line mount at the top of `SuperAdminLayout.tsx`'s root container (safety net if an operator lands back in the console mid-session).

i18n keys (EN):

```ts
          impersonationBanner: "Support session: you are inside “{{tenant}}” — {{minutes}} min left",
          impersonationExit: "Exit session",
```

(RU):

```ts
          impersonationBanner: "Режим поддержки: вы в организации «{{tenant}}» — осталось {{minutes}} мин",
          impersonationExit: "Выйти из сессии",
```

- [ ] **Step 4: Gates + commit**

`cd web && npx tsc -b && npm run lint && npm run build` → green.

```bash
git add web/src/lib/impersonation.ts web/src/components/ImpersonationBanner.tsx web/src/components/Layout.tsx web/src/pages/super-admin/SuperAdminLayout.tsx web/src/i18n.ts
git commit -m "feat(web): impersonation session plumbing + persistent banner (P1.8)"
```

---

### Task 2: Shared chips + confirm dialog + impersonate ceremony

**Files:**
- Create: `web/src/components/StatusBadge.tsx`, `web/src/components/ConfirmActionDialog.tsx`
- Modify: `web/src/pages/super-admin/OrganizationDetail.tsx` (header area: status chip + Impersonate button), `web/src/i18n.ts`

**Interfaces:**
- Consumes: Task 1's `startImpersonation`; existing `Dialog` primitives (`@/components/ui/dialog`), `Badge`, `Input`, sonner `toast`.
- Produces (consumed by Task 3):
  - `<StatusBadge status={string} />` — active→default(green-ish), suspended→amber outline, archived→secondary/gray; unknown→outline.
  - `<ConfirmActionDialog open onOpenChange title description confirmLabel onConfirm confirmText? busy?>` — when `confirmText` is set, the confirm button stays disabled until the user types it exactly.

- [ ] **Step 1: `web/src/components/StatusBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

const styles: Record<string, string> = {
  active: 'bg-primary text-primary-foreground',
  suspended: 'bg-amber-500 text-black',
  archived: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation();
  const s = status || 'active';
  return <Badge className={styles[s] ?? ''}>{t(`tenantStatus_${s}`, s)}</Badge>;
}
```

- [ ] **Step 2: `web/src/components/ConfirmActionDialog.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  /** When set, the confirm button unlocks only after this exact text is typed. */
  confirmText?: string;
  destructive?: boolean;
  busy?: boolean;
};

export function ConfirmActionDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, confirmText, destructive, busy,
}: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const locked = Boolean(confirmText) && typed !== confirmText;

  return (
    <Dialog open={open} onOpenChange={(o) => { setTyped(''); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {confirmText && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: confirmText })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={locked || busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Check `@/components/ui/dialog` export names against the actual file before finalizing (it exists — used elsewhere); adapt import list if a name differs.

- [ ] **Step 3: Impersonate ceremony in OrganizationDetail**

Read the page first. In the header block (near the back button / tenant name), add the status chip and an Impersonate button. New state + handler:

```tsx
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const impersonate = async () => {
    setImpersonating(true);
    try {
      const { data } = await api.post(`/api/super-admin/tenants/${id}/impersonate`);
      startImpersonation(data.token, {
        tenantId: data.tenant_id,
        tenantName: tenantName, // adapt to the page's actual variable holding the org name
        expiresAt: data.expires_at,
      });
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('impersonateFailed'));
      setImpersonating(false);
      setImpersonateOpen(false);
    }
  };
```

Button + dialog JSX (header area):

```tsx
  <Button variant="outline" onClick={() => setImpersonateOpen(true)}>{t('impersonate')}</Button>
  <ConfirmActionDialog
    open={impersonateOpen}
    onOpenChange={setImpersonateOpen}
    title={t('impersonateTitle')}
    description={t('impersonateDescription', { tenant: tenantName })}
    confirmLabel={t('impersonateConfirm')}
    onConfirm={impersonate}
    busy={impersonating}
  />
```

i18n keys (EN / RU):

```ts
          tenantStatus_active: "Active",
          tenantStatus_suspended: "Suspended",
          tenantStatus_archived: "Archived",
          typeToConfirm: "Type “{{text}}” to confirm:",
          impersonate: "Impersonate",
          impersonateTitle: "Start support session?",
          impersonateDescription: "You will act inside “{{tenant}}” with admin rights for 30 minutes. Every action is audit-logged and attributed to you.",
          impersonateConfirm: "Start session",
          impersonateFailed: "Failed to start impersonation session",
```

```ts
          tenantStatus_active: "Активна",
          tenantStatus_suspended: "Приостановлена",
          tenantStatus_archived: "В архиве",
          typeToConfirm: "Введите «{{text}}» для подтверждения:",
          impersonate: "Войти как поддержка",
          impersonateTitle: "Начать сессию поддержки?",
          impersonateDescription: "Вы будете действовать внутри организации «{{tenant}}» с правами администратора 30 минут. Каждое действие попадает в аудит с вашей атрибуцией.",
          impersonateConfirm: "Начать сессию",
          impersonateFailed: "Не удалось начать сессию поддержки",
```

- [ ] **Step 4: Gates + commit**

```bash
git add web/src/components/StatusBadge.tsx web/src/components/ConfirmActionDialog.tsx web/src/pages/super-admin/OrganizationDetail.tsx web/src/i18n.ts
git commit -m "feat(web): status chips, typed-confirm dialog, impersonation ceremony (P1.8)"
```

---

### Task 3: Lifecycle actions (suspend / reactivate / archive)

**Files:**
- Modify: `web/src/pages/super-admin/OrganizationDetail.tsx` (lifecycle section), `web/src/pages/super-admin/Organizations.tsx` (status column + status filter), `web/src/i18n.ts`

**Interfaces:**
- Consumes: `StatusBadge`, `ConfirmActionDialog` (Task 2); endpoints `POST .../:id/{suspend|reactivate|archive}`.
- Produces: behavior only.

- [ ] **Step 1: OrganizationDetail lifecycle section**

State + handler (`status` sourced from the loaded tenant object — the API returns `tenant.status` since Batch 1's folded fix):

```tsx
  const [lifecycleAction, setLifecycleAction] = useState<null | 'suspend' | 'reactivate' | 'archive'>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const runLifecycle = async () => {
    if (!lifecycleAction) return;
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/${lifecycleAction}`);
      toast.success(t(`lifecycle_${lifecycleAction}_done`));
      setLifecycleAction(null);
      await loadData(); // adapt to the page's actual reload function name
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };
```

Buttons (render conditionally by current status — suspend visible when `active`, reactivate when `suspended`, archive when `suspended`):

```tsx
  {tenantStatus === 'active' && (
    <Button variant="destructive" onClick={() => setLifecycleAction('suspend')}>{t('suspendTenant')}</Button>
  )}
  {tenantStatus === 'suspended' && (
    <>
      <Button onClick={() => setLifecycleAction('reactivate')}>{t('reactivateTenant')}</Button>
      <Button variant="destructive" onClick={() => setLifecycleAction('archive')}>{t('archiveTenant')}</Button>
    </>
  )}
  <ConfirmActionDialog
    open={lifecycleAction !== null}
    onOpenChange={(o) => !o && setLifecycleAction(null)}
    title={t(`lifecycle_${lifecycleAction ?? 'suspend'}_title`)}
    description={t(`lifecycle_${lifecycleAction ?? 'suspend'}_description`, { tenant: tenantName })}
    confirmLabel={t(`lifecycle_${lifecycleAction ?? 'suspend'}_confirm`)}
    onConfirm={runLifecycle}
    confirmText={lifecycleAction === 'reactivate' ? undefined : tenantName}
    destructive={lifecycleAction !== 'reactivate'}
    busy={lifecycleBusy}
  />
```

i18n (EN + RU): `suspendTenant`/`reactivateTenant`/`archiveTenant` button labels; for each action `lifecycle_<a>_title`, `lifecycle_<a>_description` (suspend: "All API access for “{{tenant}}” will be blocked within ~2 minutes."; archive: "“{{tenant}}” becomes read-blocked and is scheduled for retention cleanup. This cannot be reactivated from the UI."; reactivate: "Access for “{{tenant}}” will be restored; the block clears within ~2 minutes."), `lifecycle_<a>_confirm`, `lifecycle_<a>_done`, `lifecycleFailed`. Russian equivalents required for every key.

- [ ] **Step 2: Organizations list — status column + filter**

Add a `t('status')` column rendering `<StatusBadge status={row.tenant?.status} />`; add a status Select (all/active/suspended/archived) beside the existing plan filter, wired into `filterTenants` (`t.tenant?.status ?? 'active'`). Adapt to the file's existing `TenantRow` typing (extend it with `status?: string` on `tenant`).

- [ ] **Step 3: Gates + commit**

```bash
git add web/src/pages/super-admin/ web/src/i18n.ts
git commit -m "feat(web): tenant lifecycle actions with typed confirmation + status filters (P1.8)"
```

---

### Task 4: Create-tenant dialog (Organizations)

**Files:**
- Modify: `web/src/pages/super-admin/Organizations.tsx`, `web/src/i18n.ts`

**Interfaces:** consumes `POST /api/super-admin/tenants` `{name}` → 201; `Dialog`/`Input`/`Button`.

- [ ] **Step 1: Implement**

"+ {t('createTenant')}" button in the page header; small dialog with a single name input; on submit POST, toast success, close, `loadTenants()`. 400 → toast the server error. Keys: `createTenant`, `createTenantTitle`, `createTenantDescription` ("The organization gets the default plan automatically."), `tenantNamePlaceholder`, `createTenantDone`, `createTenantFailed` (+RU).

- [ ] **Step 2: Gates + commit**

```bash
git add web/src/pages/super-admin/Organizations.tsx web/src/i18n.ts
git commit -m "feat(web): manual tenant provisioning dialog (P1.8)"
```

---

### Task 5: Analytics page renders live aggregates

**Files:**
- Modify: `web/src/pages/super-admin/Analytics.tsx` (full replacement of the stub body), `web/src/i18n.ts`

**Interfaces:** consumes `GET /api/super-admin/analytics`:

```ts
type TimeCount = { period: string; count: number };
type PlanCount = { plan: string; count: number };
type PlatformAnalytics = {
  tenants_by_status: Record<string, number>;
  tenants_by_plan: PlanCount[] | null;
  signups_by_week: TimeCount[] | null;
  active_events: number;
  checkins_by_day: TimeCount[] | null;
  total_tenants: number;
  paid_tenants: number;
  paid_conversion: number;
};
```

- [ ] **Step 1: Implement**

Replace the stub: fetch on mount (loading/error states); render:
- four stat cards (existing `Card` primitives): total tenants, paid tenants, conversion (`(paid_conversion * 100).toFixed(1)%`), active events;
- tenants-by-status as a row of `<StatusBadge>` + counts;
- plans table (plan slug / count);
- signups_by_week and checkins_by_day as simple bar rows — no chart lib:

```tsx
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-3 rounded bg-primary" style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 4}%` }} />
      <span className="tabular-nums">{count}</span>
    </div>
  );
}
```

Empty arrays → `t('noDataYet')`. Keys: `totalTenants`, `paidTenants`, `paidConversion`, `activeEventsNow`, `tenantsByStatus`, `tenantsByPlan`, `signupsByWeek`, `checkinsByDay`, `noDataYet`, `analyticsLoadFailed` (+RU).

- [ ] **Step 2: Gates + commit**

```bash
git add web/src/pages/super-admin/Analytics.tsx web/src/i18n.ts
git commit -m "feat(web): live platform analytics — stat cards, status/plan breakdowns, CSS-bar trends (P1.8)"
```

---

### Task 6: Audit log — action filter + attribution columns

**Files:**
- Modify: `web/src/pages/super-admin/AuditLog.tsx`, `web/src/i18n.ts`

**Interfaces:** consumes `GET /api/super-admin/audit-log?action=<a>&limit=50`; rows now carry `ip_address` (string|null) and `user_agent` (string|null).

- [ ] **Step 1: Implement**

- Action filter `Select` above the table: options `all` plus the known action vocabulary (`create_tenant`, `suspend_tenant`, `reactivate_tenant`, `archive_tenant`, `impersonate_tenant`, `impersonated_request`, `create_subscription`, `update_subscription`, `create_plan`, `update_plan`); on change re-fetch with `?action=` (omit for `all`).
- Two new columns: `t('ipAddress')` (render `log.ip_address ?? '—'`) and `t('userAgent')` (render truncated `max-w-[16rem] truncate` with `title` attr for the full value).
- Keys: `filterByAction`, `allActions`, `ipAddress`, `userAgent` (+RU).

- [ ] **Step 2: Gates + commit**

```bash
git add web/src/pages/super-admin/AuditLog.tsx web/src/i18n.ts
git commit -m "feat(web): audit log action filter + ip/user-agent attribution columns (P1.8)"
```

---

## Final Verification (whole batch)

- [ ] `cd web && npx tsc -b && npm run lint && npm run build` — green.
- [ ] `cd backend && go build ./... && go test ./...` — untouched and green (no backend changes expected in this batch; a failure means scope leaked).
- [ ] **Controller-run live click-through** (dev DB + backend saas + `npm run dev`, browser): login as a super admin → Organizations shows status chips + filters → create a tenant via the dialog → open it → suspend with typed confirmation (chip flips, audit row appears) → reactivate → Impersonate → ceremony dialog → banner appears with countdown inside the customer app → perform one mutation (create event) → Exit session returns to the console with the operator token restored → Audit log shows `impersonate_tenant` + `impersonated_request` with ip/ua, filterable → Analytics renders live numbers.
- [ ] i18n spot check: switch RU — every new surface reads Russian (no raw keys).

## Out of Scope (this batch)

The brief's full visual redesign (overview queues, 6-section workbench, console visual signature, append-only billing feed — mockup-first, later); mobile/kiosk `tenant_suspended`; reason-field on impersonation (needs a backend field); audit date-range filters; plans editor rework.
