# Kiosk K2b — Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-service station mode: an attract-screen idle loop, an unattended check-in loop (`wedge`/`scanner` input only), privacy verdicts, full Tauri window lockdown, and a staff-QR-gated exit back to the Mode step.

**Architecture:** A new `/checkin/:eventId/self` route (`SelfServicePage.tsx`) reuses K2a's existing `useCheckinFlow` hook **directly and unmodified** — the check-in mutation logic (re-entrancy guard, print-on-checkin, dismiss timer) is identical between staffed and self-service; only the UI wrapped around it differs. This is a deliberate refinement over the approved spec's sketch of a brand-new `useSelfServiceFlow` hook: reading the actual K2a code (`useCheckinFlow.ts`) showed there are no separate `useSubmitCode`/`useSubmitAttendee` mutations to wrap — `useCheckinFlow` already IS that combined hook, and it's a clean, safe dependency to consume as-is (K2a stays completely untouched). The one real behavioral gap — `useCheckinFlow` deliberately never auto-dismisses `already_checked_in` (staffed mode leaves that decision to an operator) — is bridged with a small `useEffect` inside `SelfServicePage` itself that forces a dismiss after `verdict_auto_dismiss_sec`, a composition-level override that touches zero shared K2a code.

Window lockdown is two new Tauri commands (`enter_lockdown`/`exit_lockdown`) built on core `WebviewWindow` methods (`set_fullscreen`/`set_decorations`/`set_always_on_top`/`set_skip_taskbar`, all verified present in the vendored `tauri-2.11.5` source) plus an app-wide `on_window_event` handler that calls `CloseRequestApi::prevent_close()` while a shared `LockdownState` flag is set — this blocks window-close at the OS-event level, not just via the platform-inconsistent `set_closable`.

**Tech Stack:** No new npm/cargo packages. Reuses `@idento/ui/kiosk`'s existing `BrandSlot`/`LanguageToggle`/`VerdictScreen`(`privacy`)/`BlockingBanner` primitives, K2a's existing `useCheckinFlow`/`useScanInput`/`useConnectionState`/`useHeartbeat`/`useAgentDefaultPrinter`/`useAgentHealth`/`useCheckinSettings` hooks, and the existing `/auth/login-qr` backend endpoint.

## Global Constraints

- **`desktop/src/features/checkin/useCheckinFlow.ts` is never modified.** Self-service consumes it exactly as staffed `Run.tsx` does — zero regression risk to K2a's already-shipped, tested flow. The "always auto-dismiss" requirement for self-service is a `SelfServicePage`-local `useEffect`, never a change to the shared hook's dismiss-timer logic.
- Self-service never renders a manual-search UI and the Mode step never lets an operator select `scan_input: "manual"` while station type is Self-service. But `checkin-settings` is an **event-wide** setting (K2a's own documented risk: one station's scan-input choice affects every station on that event) — so `SelfServicePage` must defensively treat an inherited `scan_input: "manual"` (set by a different, staffed station on the same event, active during self-service's lifetime) as `wedge`, never render a broken/empty input surface.
- No new npm packages, no new Cargo crates. `enter_lockdown`/`exit_lockdown` use only core `tauri`/`tauri::WebviewWindow` APIs already available via the existing `tauri` dependency.
- `desktop/src-tauri/tauri.conf.json` is not modified — lockdown is pure runtime window-API calls, no bundle/plugin config needed.
- Lockdown only ever engages within `SelfServicePage`'s own mount lifecycle. It must never be reachable from `Run.tsx` or any pre-flight page.
- **Deviation from the approved spec's exact wording:** the spec described the degraded/blocked banner as reusing `BlockingBanner`'s styling "without a retry button." `BlockingBanner`'s actual props (`packages/ui/src/kiosk/blocking-banner.tsx`) make `retryLabel`/`onRetry` mandatory, not optional, so a literal no-retry variant isn't a simple prop omission. Task 3 instead wires a real retry (`refetch()` on the relevant query) — safe, since it only re-checks hardware/connection status and exposes no bypass or escape capability, unlike a retry that might let an attendee override a real block.
- Known environment hazard (from K1/K2a/K3a/K3b): a shell wrapper (RTK) active in this environment can make `npm run lint`/`npm run build`/`cargo build` output look like a broken/missing config when it isn't. Verify with a direct tool invocation before concluding anything is actually broken.
- Commit after every task.

---

### Task 1: Mode step — station-type toggle + scan_input restriction

**Files:**
- Modify: `desktop/src/pages/Mode.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: nothing new from earlier K2b tasks (first task).
- Produces:

```ts
export type StationType = "staffed" | "self";
export function loadStationType(): StationType; // desktop/src/pages/Mode.tsx
```

This task has no dedicated component test — no pre-flight page in this codebase has one (established K2a/K3a/K3b convention; `loadRunLayout`, the closest existing precedent to `loadStationType`, has none either). Verification is typecheck/lint/build plus a documented manual check.

- [ ] **Step 1: Add the new i18n keys**

Read `desktop/src/i18n.ts` first. In the `en.translation` block, add right after the `continueButton: "Continue",` line (immediately before `modeLayoutTitle`):

```ts
        modeStationTypeTitle: "Station type",
        modeStationTypeStaffed: "Staffed",
        modeStationTypeSelf: "Self-service",
```

In the `ru.translation` block, add right after its `continueButton: "Продолжить",` line (immediately before `modeLayoutTitle`):

```ts
        modeStationTypeTitle: "Тип станции",
        modeStationTypeStaffed: "С оператором",
        modeStationTypeSelf: "Самообслуживание",
```

- [ ] **Step 2: Add `StationType`/`loadStationType` and the station-type state to `Mode.tsx`**

Read `desktop/src/pages/Mode.tsx` first (in full). Change the top of the file from:

```tsx
export type RunLayout = "bar" | "panel";

const RUN_LAYOUT_KEY = "idento_run_layout";

// eslint-disable-next-line react-refresh/only-export-components
export function loadRunLayout(): RunLayout {
  return localStorage.getItem(RUN_LAYOUT_KEY) === "panel" ? "panel" : "bar";
}
```

to:

```tsx
export type RunLayout = "bar" | "panel";
export type StationType = "staffed" | "self";

const RUN_LAYOUT_KEY = "idento_run_layout";
const STATION_TYPE_KEY = "idento_station_type";

// eslint-disable-next-line react-refresh/only-export-components
export function loadRunLayout(): RunLayout {
  return localStorage.getItem(RUN_LAYOUT_KEY) === "panel" ? "panel" : "bar";
}

// eslint-disable-next-line react-refresh/only-export-components
export function loadStationType(): StationType {
  return localStorage.getItem(STATION_TYPE_KEY) === "self" ? "self" : "staffed";
}
```

- [ ] **Step 3: Add `stationType` state + sanitizing setter inside `ModePage`**

Change:

```tsx
  const [layout, setLayout] = useState<RunLayout>(loadRunLayout);
  const [settings, setSettings] = useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);
  const [updateManifestUrl, setUpdateManifestUrl] = useState(() => getManifestUrlOverride());
```

to:

```tsx
  const [layout, setLayout] = useState<RunLayout>(loadRunLayout);
  const [stationType, setStationType] = useState<StationType>(loadStationType);
  const [settings, setSettings] = useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);
  const [updateManifestUrl, setUpdateManifestUrl] = useState(() => getManifestUrlOverride());
```

Then, right after that block (before `useEffect(() => { if (settingsQuery.data) ...`), add:

```tsx
  const selectStationType = (value: StationType) => {
    setStationType(value);
    // scan_input is an EVENT-wide setting (shared with any staffed station
    // on the same event) -- if it's currently "manual" when switching to
    // Self-service, sanitize it immediately rather than silently saving an
    // invalid-for-self-service combination.
    if (value === "self" && settings.scan_input === "manual") {
      setSettings((prev) => ({ ...prev, scan_input: "wedge" }));
    }
  };
```

- [ ] **Step 4: Update `saveAndStart` to persist station type and route accordingly**

Change:

```tsx
  const saveAndStart = async () => {
    try {
      await saveSettings.mutateAsync(settings);
      localStorage.setItem(RUN_LAYOUT_KEY, layout);
      setManifestUrlOverride(updateManifestUrl);
      navigate(`/checkin/${eventId}`);
    } catch {
      toast.error(t("checkinSettingsSaveFailed"));
    }
  };
```

to:

```tsx
  const saveAndStart = async () => {
    try {
      await saveSettings.mutateAsync(settings);
      localStorage.setItem(RUN_LAYOUT_KEY, layout);
      localStorage.setItem(STATION_TYPE_KEY, stationType);
      setManifestUrlOverride(updateManifestUrl);
      navigate(stationType === "self" ? `/checkin/${eventId}/self` : `/checkin/${eventId}`);
    } catch {
      toast.error(t("checkinSettingsSaveFailed"));
    }
  };
```

- [ ] **Step 5: Add the station-type toggle to the JSX, gate the layout picker, and restrict scan_input options**

Read the current JSX body first. Add a local `scanInputOptions` const right before the `return (` statement:

```tsx
  const scanInputOptions = stationType === "self" ? (["wedge", "scanner"] as const) : (["wedge", "scanner", "manual"] as const);
```

Change the JSX from:

```tsx
        <div className="flex flex-col gap-7">
          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeLayoutTitle")}</div>
            <div className="mt-3 flex gap-3">
              {(["bar", "panel"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={layout === value}
                  className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(layout === value)}`}
                  onClick={() => setLayout(value)}
                >
                  {value === "bar" ? t("modeLayoutBar") : t("modeLayoutPanel")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeScanInputTitle")}</div>
            <div className="mt-3 flex gap-3">
              {(["wedge", "scanner", "manual"] as const).map((value) => (
```

to:

```tsx
        <div className="flex flex-col gap-7">
          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeStationTypeTitle")}</div>
            <div className="mt-3 flex gap-3">
              {(["staffed", "self"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={stationType === value}
                  className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(stationType === value)}`}
                  onClick={() => selectStationType(value)}
                >
                  {value === "staffed" ? t("modeStationTypeStaffed") : t("modeStationTypeSelf")}
                </button>
              ))}
            </div>
          </div>

          {stationType === "staffed" && (
            <div>
              <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeLayoutTitle")}</div>
              <div className="mt-3 flex gap-3">
                {(["bar", "panel"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={layout === value}
                    className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(layout === value)}`}
                    onClick={() => setLayout(value)}
                  >
                    {value === "bar" ? t("modeLayoutBar") : t("modeLayoutPanel")}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeScanInputTitle")}</div>
            <div className="mt-3 flex gap-3">
              {scanInputOptions.map((value) => (
```

Everything after that `.map((value) => (` line (the button body, closing tags, and the rest of the file) stays byte-identical — only the array the `.map()` iterates over changed from a literal `(["wedge", "scanner", "manual"] as const)` to the new `scanInputOptions` variable.

- [ ] **Step 6: Run typecheck, lint, and build**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean.

- [ ] **Step 7: Manual verification (documented, not automated)**

Document in the PR description: ran `npm run tauri dev -w idento-desktop`, walked through the Mode step confirming the Staffed/Self-service toggle works, confirmed the layout picker disappears and the `manual` scan-input button disappears when Self-service is selected, confirmed switching to Self-service while `scan_input` was `manual` resets it to `wedge` visibly.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/pages/Mode.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): Mode step gains a Staffed/Self-service station-type toggle"
```

---

### Task 2: Tenant-logo utility + `AttractScreen` component

**Files:**
- Create: `desktop/src/lib/tenantBranding.ts`
- Test: `desktop/src/lib/tenantBranding.test.ts`
- Create: `desktop/src/components/AttractScreen.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: `BrandSlot`/`LanguageToggle` from `@idento/ui/kiosk` (already shipped, K1).
- Produces:

```ts
// tenantBranding.ts
export function getTenantLogoUrl(): string | undefined;

// AttractScreen.tsx
export function AttractScreen(): JSX.Element; // no props
```

- [ ] **Step 1: Write the failing tests for `getTenantLogoUrl`**

Create `desktop/src/lib/tenantBranding.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getTenantLogoUrl } from "./tenantBranding";

afterEach(() => {
  localStorage.clear();
});

describe("getTenantLogoUrl", () => {
  it("returns undefined when no current_tenant is cached", () => {
    expect(getTenantLogoUrl()).toBeUndefined();
  });

  it("returns undefined when current_tenant has no logo_url", () => {
    localStorage.setItem("current_tenant", JSON.stringify({ id: "t1", name: "Acme" }));
    expect(getTenantLogoUrl()).toBeUndefined();
  });

  it("returns undefined when current_tenant is malformed JSON", () => {
    localStorage.setItem("current_tenant", "{not json");
    expect(getTenantLogoUrl()).toBeUndefined();
  });

  it("returns the logo_url when present", () => {
    localStorage.setItem("current_tenant", JSON.stringify({ id: "t1", name: "Acme", logo_url: "https://cdn.example/acme.png" }));
    expect(getTenantLogoUrl()).toBe("https://cdn.example/acme.png");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/lib/tenantBranding.test.ts`
Expected: FAIL (module `./tenantBranding` not found).

- [ ] **Step 3: Create `desktop/src/lib/tenantBranding.ts`**

```ts
// Reads the tenant logo cached by Login.tsx's /auth/login response
// (current_tenant, the full backend Tenant object, includes logo_url).
// Deliberately does NOT hit the network -- self-service's AttractScreen
// must never block on a request just to show its brand slot. QRLogin.tsx's
// /auth/login-qr response does not include current_tenant at all (a
// pre-existing, K2b-unrelated backend inconsistency) -- a station set up
// via QR login simply has no cached logo here, handled by the caller
// (AttractScreen) falling back to BrandSlot's own empty-state rendering,
// not by this function throwing or guessing.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getTenantLogoUrl(): string | undefined {
  try {
    const raw = localStorage.getItem("current_tenant");
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return undefined;
    return typeof parsed.logo_url === "string" ? parsed.logo_url : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/lib/tenantBranding.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Add the `AttractScreen` i18n key**

Read `desktop/src/i18n.ts` first. In the `en.translation` block, add right after the last `run*` key (`runAutoReturning: "Returning to scan…",`, the final key before the closing `},` of that block):

```ts
        selfAttractTitle: "Scan your ticket to check in",
```

In the `ru.translation` block, add right after its equivalent last `run*` key (`runAutoReturning: "Возврат к сканированию…",` or whatever the exact RU text is — read the file to confirm the exact string, insert immediately after it, before that block's closing `},`):

```ts
        selfAttractTitle: "Отсканируйте билет для регистрации",
```

- [ ] **Step 6: Create `desktop/src/components/AttractScreen.tsx`**

```tsx
// Self-service idle screen (K2b): tenant brand slot + language toggle (the
// only interactive element) + a slow drift transform against screen
// burn-in. Rendered by SelfServicePage whenever the check-in loop is idle
// (no scan in flight, no verdict showing).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandSlot, LanguageToggle } from "@idento/ui/kiosk";
import { getTenantLogoUrl } from "@/lib/tenantBranding";

const DRIFT_CYCLE_MS = 60_000;
const DRIFT_RANGE_PX = 24;

const LANGUAGE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "ru", label: "RU" },
];

export function AttractScreen() {
  const { t, i18n } = useTranslation();
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  const logoUrl = getTenantLogoUrl();

  useEffect(() => {
    let raf: number;
    const start = Date.now();
    function tick() {
      const elapsed = (Date.now() - start) % DRIFT_CYCLE_MS;
      const angle = (elapsed / DRIFT_CYCLE_MS) * Math.PI * 2;
      setDrift({ x: Math.cos(angle) * DRIFT_RANGE_PX, y: Math.sin(angle) * DRIFT_RANGE_PX });
      raf = window.requestAnimationFrame(tick);
    }
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-11" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
      {logoUrl ? <BrandSlot src={logoUrl} alt={t("appName")} /> : <BrandSlot />}
      <div className="kiosk-type-idle-title text-kiosk-text">{t("selfAttractTitle")}</div>
      <LanguageToggle
        value={i18n.language?.slice(0, 2) ?? "en"}
        options={LANGUAGE_OPTIONS}
        onChange={(lang) => void i18n.changeLanguage(lang)}
      />
    </div>
  );
}
```

(`BrandSlot`'s prop type is a discriminated union — `{ src: string; alt: string }` or `{ src?: undefined }` — so `logoUrl`, typed `string | undefined`, can't be spread into one call directly; the `logoUrl ? <BrandSlot src={logoUrl} alt={...} /> : <BrandSlot />` branch is required, not a style choice.)

No dedicated component test for `AttractScreen` — matches the established page/component convention (verified in Task 1's own note); its one piece of real logic (`getTenantLogoUrl`) is already covered by Step 1-4's unit tests.

- [ ] **Step 7: Run typecheck, lint, and the full test suite**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm test -w idento-desktop
```

Expected: all clean; test count includes the 4 new `tenantBranding.test.ts` cases.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/lib/tenantBranding.ts desktop/src/lib/tenantBranding.test.ts desktop/src/components/AttractScreen.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): tenant-logo utility + self-service AttractScreen"
```

---

### Task 3: `SelfServicePage` + routing

**Files:**
- Create: `desktop/src/pages/SelfService.tsx`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: `AttractScreen` (Task 2), `useCheckinFlow` from `@/features/checkin/useCheckinFlow` (K2a, unmodified), `useScanInput`/`useConnectionState`/`useHeartbeat`/`useCheckinSettings`/`useAgentDefaultPrinter`/`useAgentHealth` (K2a, unmodified), `DEFAULT_CHECKIN_SETTINGS` from `@/features/checkin/settingsTypes`.
- Produces: default-exported `SelfServicePage` at route `/checkin/:eventId/self`.

No dedicated component test — matches the established convention (Task 1's note; `Run.tsx`, the closest structural precedent, has none either). Verification is typecheck/lint/build plus a documented manual walkthrough.

- [ ] **Step 1: Add self-service i18n keys**

Read `desktop/src/i18n.ts` first. In the `en.translation` block, add right after the `selfAttractTitle` key added in Task 2:

```ts
        selfAllowedMessage: "You're checked in. Welcome!",
        selfAlreadyMessage: "Already checked in",
        selfBlockedMessage: "Please see a staff member",
        selfNotFoundMessage: "Code not found — please see a staff member",
        selfAgentUnavailable: "Station temporarily unavailable",
```

In the `ru.translation` block, add right after that block's `selfAttractTitle` key:

```ts
        selfAllowedMessage: "Вы зарегистрированы. Добро пожаловать!",
        selfAlreadyMessage: "Уже зарегистрирован(а)",
        selfBlockedMessage: "Обратитесь к сотруднику",
        selfNotFoundMessage: "Код не найден — обратитесь к сотруднику",
        selfAgentUnavailable: "Станция временно недоступна",
```

- [ ] **Step 2: Create `desktop/src/pages/SelfService.tsx`**

```tsx
// Self-service run screen (K2b). Reuses K2a's useCheckinFlow directly and
// unmodified -- the same re-entrancy guard, print-on-checkin, and dismiss
// timer staffed Run.tsx relies on. The one behavioral gap -- useCheckinFlow
// deliberately never auto-dismisses "already_checked_in" (an operator
// decides, in staffed mode) -- is bridged below with a local effect, not a
// change to the shared hook: self-service has no operator, so every
// verdict must eventually return to the attract screen on its own.
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { VerdictScreen, BlockingBanner } from "@idento/ui/kiosk";
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinSettings,
} from "@/features/checkin/hooks";
import { useCheckinFlow } from "@/features/checkin/useCheckinFlow";
import { useConnectionState } from "@/features/checkin/useConnectionState";
import { useHeartbeat } from "@/features/checkin/useHeartbeat";
import { useScanInput } from "@/features/checkin/useScanInput";
import { DEFAULT_CHECKIN_SETTINGS } from "@/features/checkin/settingsTypes";
import { AttractScreen } from "@/components/AttractScreen";

export default function SelfServicePage() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const stationId = localStorage.getItem(`idento_station_id:${eventId}`);

  useHeartbeat(eventId!, stationId);
  const connection = useConnectionState(eventId!);
  const settingsQuery = useCheckinSettings(eventId!);
  const settings = settingsQuery.data ?? DEFAULT_CHECKIN_SETTINGS;
  const printer = useAgentDefaultPrinter();
  const agentHealth = useAgentHealth();

  const printerGateActive = settings.print_on_checkin && !printer.data;

  const flow = useCheckinFlow({
    eventId: eventId!,
    stationId,
    settings,
    printerName: printer.data ?? "",
  });

  useEffect(() => {
    if (flow.state.status !== "verdict" || flow.state.verdict !== "already_checked_in") return;
    const timer = window.setTimeout(() => flow.clear(), settings.verdict_auto_dismiss_sec * 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.state.status, flow.state.verdict, settings.verdict_auto_dismiss_sec]);

  const scanEnabled = flow.state.status === "idle" && connection.online && !printerGateActive;

  // checkin-settings is event-wide (shared with any staffed station on the
  // same event) -- a "manual" value could be inherited mid-session from a
  // different station. Self-service renders no manual-search UI at all, so
  // treat that case as "wedge" rather than silently capturing nothing.
  const { wedgeInputProps } = useScanInput({
    mode: settings.scan_input === "manual" ? "wedge" : settings.scan_input,
    onCode: (code) => void flow.submitCode(code).catch(() => {}),
    enabled: scanEnabled,
  });

  const verdictProps = (() => {
    if (flow.state.status !== "verdict" || !flow.state.verdict) return null;
    const v = flow.state.verdict;
    const name = flow.state.attendee ? `${flow.state.attendee.first_name} ${flow.state.attendee.last_name}` : undefined;
    // title is required by VerdictScreenProps even though privacy mode
    // never renders it -- reusing Run.tsx's existing run*Title keys avoids
    // new i18n entries for a value that's never actually shown.
    if (v === "allowed") return { verdict: v, title: t("runAllowedTitle"), name, message: t("selfAllowedMessage") };
    if (v === "already_checked_in") return { verdict: v, title: t("runAlreadyTitle"), name, message: t("selfAlreadyMessage") };
    if (v === "no_access") return { verdict: v, title: t("runBlockedTitle"), name, message: t("selfBlockedMessage") };
    return { verdict: v, title: t("runNotFoundTitle"), message: t("selfNotFoundMessage") };
  })();

  return (
    <div className="relative flex h-screen flex-col bg-kiosk-bg" style={{ fontFamily: "var(--kiosk-font)" }}>
      {!connection.online && (
        <BlockingBanner
          title={t("runNoServer")}
          subtitle={t("runNoServerDesc")}
          retryLabel={t("runRetryNow")}
          onRetry={() => void settingsQuery.refetch()}
        />
      )}
      {connection.online && !agentHealth.data && (
        <BlockingBanner title={t("selfAgentUnavailable")} retryLabel={t("runRetryNow")} onRetry={() => void agentHealth.refetch()} />
      )}
      <div className="flex flex-1 items-center justify-center">
        {verdictProps ? (
          <VerdictScreen {...verdictProps} privacy className="h-full w-full" />
        ) : printerGateActive ? (
          <p className="text-kiosk-text-3">{t("runPrinterWaiting")}</p>
        ) : (
          <AttractScreen />
        )}
      </div>
      <input aria-hidden {...wedgeInputProps} className="sr-only" />
    </div>
  );
}
```

- [ ] **Step 3: Register the `/checkin/:eventId/self` route**

Read `desktop/src/App.tsx` first. Add the import alongside the other page imports:

```tsx
import SelfServicePage from "./pages/SelfService";
```

Add the route right after the existing `/checkin/:eventId/mode` route and before `/checkin/:eventId`:

```tsx
        <Route
          path="/checkin/:eventId/self"
          element={
            <ProtectedRoute>
              <SelfServicePage />
            </ProtectedRoute>
          }
        />
```

- [ ] **Step 4: Run typecheck, lint, and build**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean.

- [ ] **Step 5: Manual verification (documented, not automated)**

Document in the PR description: ran `npm run tauri dev -w idento-desktop`, set a station to Self-service on the Mode step, confirmed navigating there lands on the attract screen, confirmed a valid scanned/typed-via-wedge code produces a privacy verdict (name + message, no title/meta/actions) that auto-returns to the attract screen, confirmed an `already_checked_in` result also auto-returns (unlike staffed mode), confirmed the printer-wait and agent/connection banners appear when those services are down.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/pages/SelfService.tsx desktop/src/App.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): self-service run screen + /checkin/:eventId/self route"
```

---

### Task 4: Rust — `enter_lockdown`/`exit_lockdown` commands + window-close guard

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/pages/SelfService.tsx`

**Interfaces:**
- Consumes: nothing new from earlier K2b tasks (Rust-side). `SelfServicePage.tsx` (Task 3) is modified to invoke the two new commands.
- Produces:

```rust
pub struct LockdownState(pub std::sync::Mutex<bool>); // Default
// enter_lockdown(app: AppHandle, state: State<'_, LockdownState>) -> Result<(), String>
// exit_lockdown(app: AppHandle, state: State<'_, LockdownState>) -> Result<(), String>
```

- [ ] **Step 1: Write the failing test for `LockdownState`'s default**

Add a new test module at the end of `desktop/src-tauri/src/commands.rs`, after the existing `#[cfg(test)] mod update_tests { ... }` block:

```rust
#[cfg(test)]
mod lockdown_tests {
    use super::*;

    #[test]
    fn starts_unlocked() {
        let state = LockdownState::default();
        assert!(!*state.0.lock().unwrap());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `cd desktop/src-tauri && cargo test --lib lockdown_tests`
Expected: compile error — `LockdownState` doesn't exist yet.

- [ ] **Step 3: Add the `Manager` import**

Read `desktop/src-tauri/src/commands.rs` first. Change:

```rust
use std::sync::Mutex;
use tauri::{AppHandle, State};
```

to:

```rust
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
```

(`Manager` is required for `AppHandle::get_webview_window`, used by both new commands below — the existing imports don't already bring it into scope in this file, unlike `lib.rs`.)

- [ ] **Step 4: Implement `LockdownState` and the two commands**

Add the following immediately after `install_update`'s closing brace (i.e., right before the existing `#[cfg(test)] mod tests` block):

```rust
/// Whether the main window is currently in self-service lockdown (K2b):
/// fullscreen, undecorated, always-on-top, hidden from the taskbar/dock,
/// and window-close is blocked at the OS-event level (see `lib.rs`'s
/// `on_window_event` registration) -- not just via `set_closable`, which
/// has a documented Linux caveat ("GTK+ will do its best", not a hard
/// guarantee). Read by that same window-event handler to decide whether to
/// call `prevent_close()`.
#[derive(Default)]
pub struct LockdownState(pub Mutex<bool>);

/// Engages self-service lockdown on the main window. Idempotent -- calling
/// this while already locked down just re-applies the same state.
#[tauri::command]
pub fn enter_lockdown(app: AppHandle, state: State<'_, LockdownState>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "No main window".to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = true;
    Ok(())
}

/// Reverses `enter_lockdown`. Called only after a successful staff-QR check
/// (see the desktop `StaffExitOverlay` component, Task 5) -- never
/// reachable from window-close or keyboard shortcuts, since those are
/// blocked outright while locked down.
#[tauri::command]
pub fn exit_lockdown(app: AppHandle, state: State<'_, LockdownState>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "No main window".to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = false;
    window.set_skip_taskbar(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_decorations(true).map_err(|e| e.to_string())?;
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd desktop/src-tauri && cargo test --lib`
Expected: PASS — 20 pre-existing tests (unchanged) + 1 new `lockdown_tests` = 21 total.

- [ ] **Step 6: Register the state, commands, and window-close guard in `lib.rs`**

Read `desktop/src-tauri/src/lib.rs` first, then replace its contents:

```rust
//! Idento Kiosk - Tauri desktop app for check-in and equipment settings.

mod commands;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::AgentProcess::default())
        .manage(commands::UpdateHandleState::default())
        .manage(commands::LockdownState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_request,
            commands::get_agent_port,
            commands::spawn_agent,
            commands::stop_agent,
            commands::restart_agent,
            commands::check_for_update,
            commands::install_update,
            commands::enter_lockdown,
            commands::exit_lockdown,
        ])
        .on_window_event(|window, event| {
            // Self-service lockdown (K2b): while LockdownState is true,
            // block window-close outright at the event level rather than
            // relying on set_closable alone (documented Linux caveat: GTK+
            // "will do its best", not a guarantee). Fails open (does NOT
            // prevent_close) if the state can't be read at all, since a
            // poisoned lockdown flag should never be able to trap the app
            // closed.
            if let WindowEvent::CloseRequested { api } = event {
                let locked = window
                    .try_state::<commands::LockdownState>()
                    .and_then(|state| state.0.lock().ok())
                    .map(|guard| *guard)
                    .unwrap_or(false);
                if locked {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Idento Kiosk")
        .run(|app_handle, event| {
            // tauri-plugin-shell's own on_event hook kills children it
            // spawned via its JS-invoked IPC command on RunEvent::Exit --
            // it does not cover commands::spawn_agent, which calls
            // Command::spawn() directly from Rust (see AgentProcess's own
            // doc comment). RunEvent::Exit (not ExitRequested) matches the
            // shell plugin's own choice: Exit fires only once the app is
            // definitely closing, whereas ExitRequested can be intercepted
            // and the exit cancelled. install_update's request_restart()
            // also triggers this same Exit event, so the sidecar is
            // cleanly stopped before the app relaunches post-update, with
            // no special-casing needed here.
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<commands::AgentProcess>() {
                    commands::kill_agent_process(&state);
                }
            }
        });
}
```

(Three changes from the current file: `WindowEvent` added to the `use` line; `.manage(commands::LockdownState::default())` added; `commands::enter_lockdown`/`commands::exit_lockdown` added to `generate_handler!`; the new `.on_window_event(...)` block added before `.build(...)`. Everything else is byte-identical to the current file.)

- [ ] **Step 7: Verify it builds and all tests still pass**

```bash
cd desktop/src-tauri && cargo build && cargo test --lib
```

Expected: clean build, 21/21 tests pass.

- [ ] **Step 8: Wire `enter_lockdown`/`exit_lockdown` into `SelfServicePage`'s mount/unmount**

Read `desktop/src/pages/SelfService.tsx` (as it stands after Task 3) first. Add a new `useEffect` import to the existing `import { useEffect } from "react";` line — it's already imported, no change needed there. Add the following new `useEffect`, placed right after the `useHeartbeat(eventId!, stationId);` line:

```tsx
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (active) await invoke("enter_lockdown");
      } catch {
        // Not running under Tauri (e.g. plain browser dev) -- no window to
        // lock down; the rest of the page still functions for local dev.
      }
    })();
    return () => {
      active = false;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("exit_lockdown");
        } catch {
          // Same non-Tauri dev fallback as above.
        }
      })();
    };
  }, []);
```

- [ ] **Step 9: Run typecheck, lint, and build**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean.

- [ ] **Step 10: Manual verification (documented, not automated, real device required)**

The actual window-manipulation behavior (fullscreen takes effect, decorations disappear, the window truly cannot be closed via the OS's own controls or keyboard shortcuts, `always_on_top`/`skip_taskbar` behave sanely under the host window manager) has never been exercised outside this sandboxed environment and cannot be verified here — same class of open item already flagged for K3a's sidecar lifecycle and K3b's update lifecycle. Document this explicitly in the PR description as a genuinely open, non-code-fixable-in-this-environment gap, not a silently-assumed pass.

- [ ] **Step 11: Commit**

```bash
git add desktop/src-tauri/src/commands.rs desktop/src-tauri/src/lib.rs desktop/src/pages/SelfService.tsx
git commit -m "feat(desktop): enter_lockdown/exit_lockdown Tauri commands + self-service wiring"
```

---

### Task 5: Staff-QR exit overlay

**Files:**
- Create: `desktop/src/components/StaffExitOverlay.tsx`
- Modify: `desktop/src/pages/SelfService.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: existing `POST /auth/login-qr` backend endpoint (already used by `QRLogin.tsx`), `exit_lockdown` Tauri command (Task 4).
- Produces: `StaffExitOverlay` component (no props), rendered unconditionally inside `SelfServicePage`.

No dedicated component test — matches the established convention (Task 1's note; `QRLogin.tsx`, the closest structural precedent for a QR-token form, has none either). Verification is typecheck/lint/build plus a documented manual check.

- [ ] **Step 1: Add the exit-overlay i18n keys**

Read `desktop/src/i18n.ts` first. In the `en.translation` block, add right after the `selfAgentUnavailable` key added in Task 3:

```ts
        selfStaffExit: "Staff exit",
        selfStaffExitConfirm: "Exit self-service",
```

In the `ru.translation` block, add right after that block's `selfAgentUnavailable` key:

```ts
        selfStaffExit: "Выход для персонала",
        selfStaffExitConfirm: "Выйти из режима самообслуживания",
```

- [ ] **Step 2: Create `desktop/src/components/StaffExitOverlay.tsx`**

```tsx
// Staff-QR exit trigger for self-service lockdown (K2b). Reuses the exact
// same POST /auth/login-qr check QRLogin.tsx already does for normal
// staff login -- success replaces the current session (same as a fresh QR
// login) and calls exit_lockdown before navigating back to the Mode step.
// Rendered unconditionally by SelfServicePage so it's reachable from every
// self-service state (attract, scanning, or a verdict showing) -- a real
// hardware problem shouldn't have to wait out a verdict's auto-return
// timer before staff can intervene.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QrCode } from "lucide-react";
import { KioskButton, KioskInput } from "@idento/ui/kiosk";
import { api } from "@/lib/api";

export function StaffExitOverlay() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const [open, setOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const close = () => {
    setOpen(false);
    setError("");
    setQrToken("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/auth/login-qr", { qr_token: qrToken.trim() });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("exit_lockdown");
      } catch {
        // Not running under Tauri (e.g. plain browser dev) -- nothing to
        // reverse; the Mode navigation below still happens.
      }
      navigate(`/checkin/${eventId}/mode`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(msg || t("invalidQRToken"));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-label={t("selfStaffExit")}
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-4 rounded-full p-3 text-kiosk-text opacity-20 hover:opacity-70 focus-visible:opacity-70"
      >
        <QrCode aria-hidden className="size-6" />
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-kiosk-overlay-ink">
      <form onSubmit={handleSubmit} className="flex w-[480px] flex-col gap-5 rounded-3xl border border-kiosk-border bg-kiosk-surface p-10">
        <div className="kiosk-type-verdict-title text-kiosk-text" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.7)" }}>
          {t("selfStaffExit")}
        </div>
        <KioskInput mono type="text" placeholder={t("enterQRToken")} value={qrToken} onChange={(e) => setQrToken(e.target.value)} autoFocus />
        {error && <p className="text-kiosk-danger-soft">{error}</p>}
        <div className="flex gap-3">
          <KioskButton type="submit" disabled={loading}>
            {loading ? "…" : t("selfStaffExitConfirm")}
          </KioskButton>
          <KioskButton type="button" variant="ghost" onClick={close} disabled={loading}>
            {t("cancel")}
          </KioskButton>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Render `StaffExitOverlay` inside `SelfServicePage`**

Read `desktop/src/pages/SelfService.tsx` (as it stands after Task 4) first. Add the import:

```tsx
import { StaffExitOverlay } from "@/components/StaffExitOverlay";
```

Add `<StaffExitOverlay />` as the last child inside the root `<div className="relative flex h-screen ...">`, right after the existing `<input aria-hidden {...wedgeInputProps} className="sr-only" />` line:

```tsx
      <input aria-hidden {...wedgeInputProps} className="sr-only" />
      <StaffExitOverlay />
    </div>
  );
}
```

(The root `<div>` already has `className="relative flex h-screen flex-col bg-kiosk-bg"` from Task 3 — `relative` is required for `StaffExitOverlay`'s `absolute` positioning to anchor correctly, already present, no change needed there.)

- [ ] **Step 4: Run typecheck, lint, and build**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean.

- [ ] **Step 5: Run the full test suite**

```bash
npm test -w idento-desktop
```

Expected: all clean (no new test count change in this task — see the "no dedicated component test" note above; the count already grew in Task 2).

- [ ] **Step 6: Manual verification (documented, not automated)**

Document in the PR description: ran `npm run tauri dev -w idento-desktop`, confirmed the exit tap-target is visible-but-subtle in the self-service screen's corner, confirmed tapping it opens the QR-entry overlay from the attract state AND from a showing verdict (not just attract), confirmed an invalid token shows an inline error and stays locked, confirmed a valid staff QR token exits lockdown and lands back on the Mode step.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/StaffExitOverlay.tsx desktop/src/pages/SelfService.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): staff-QR exit overlay for self-service lockdown"
```

---
