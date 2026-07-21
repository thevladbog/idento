# Kiosk K2a — Staffed-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `desktop/`'s check-in flow onto the backend's server-side check-in loop (idempotent check-in, station registration/heartbeat, audit feed), and restyle the entire pre-flight + staffed-run experience onto `@idento/ui/kiosk` (K1).

**Architecture:** Port panel's proven check-in-loop hooks (`useCheckinFlow`/`useScanInput`/`useHeartbeat`/`useConnectionState`, `verdict.ts`, `settingsTypes.ts`) into `desktop/src/features/checkin/`, adapted to desktop's transport (Tauri agent invoke instead of browser fetch, agent ZPL printing instead of browser print) and data layer (TanStack Query added, wrapping the existing axios instance). All 5 pre-flight screens and the run screen move onto `PreflightShell`/`KioskButton`/`KioskInput`/`TopStatusBar`/`OperatorPanel`/`VerdictScreen`/`RecentLog` (all already built and merged in K1).

**Tech Stack:** React 19, TypeScript, Vite, `@tanstack/react-query` (new), `@idento/ui/kiosk`, Vitest + Testing Library (new to `desktop`), axios (existing `lib/api.ts`), Tauri agent invoke (existing `lib/agent.ts`).

## Global Constraints

- Registry pinned: `.npmrc` already has `registry=https://registry.npmjs.com/` — do not touch.
- `desktop` is in the npm workspace (K1) — install/test/typecheck/lint from the repo root or via `-w idento-desktop`, never a separate `desktop/package-lock.json`.
- `@idento/ui`/`@idento/ui/kiosk` rules apply to anything imported from there (do not add logic to that package in this plan — it's consumed, not modified).
- `packages/ui/eslint.config.js` and any file outside `desktop/` must not be touched by this plan — everything here is scoped to `desktop/`.
- Do not modify `panel/` — this plan ports the *pattern* of `panel/src/features/checkin/`, never imports from it or edits it.
- `CheckinOutcome` mapping is fixed: `checked_in→allowed`, `already_checked_in→already_checked_in`, `blocked→no_access`, client-side `not_found→not_registered` (never invert or add a 4th server outcome — `not_found` never reaches the server).
- `already_checked_in` verdicts never auto-dismiss (operator decides); `allowed` (`checked_in`) auto-dismisses after `settings.verdict_auto_dismiss_sec` seconds.
- Printing fires automatically ONLY on the server's own `checked_in` outcome, gated by `settings.print_on_checkin` — never on `already_checked_in`/`blocked`, regardless of settings.
- Auto-print calls `markAttendeePrinted` WITHOUT `event_id`/`station_id` (counter-only, no reprint audit row — the check-in itself already logged the feed row). Manual "Печать" (only rendered when `!(verdict === "allowed" && settings.print_on_checkin)`) calls `markAttendeePrinted` WITH `event_id`+`station_id` (creates a `reprint` audit row).
- `RecentLog` on the kiosk stays passive — no Undo/Reprint buttons wired to it in K2a (that remains a panel/staff action on a different device).
- Camera scan input is explicitly out of scope for K2a (backend `scan_input` enum is `wedge | scanner | manual` only).
- Self-service mode is out of scope for K2a (K2b).
- Test/lint versions match the rest of the monorepo exactly: `vitest ^4.1.10`, `jsdom ^25.0.1`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`, `@testing-library/user-event ^14.6.1`, `@tanstack/react-query ^5.101.2` (same as `panel/package.json`).
- Known environment hazard (from K1): a shell wrapper (RTK) active in this environment can make `npm run lint`/`npm run build` output look like a broken/missing config when it isn't. If a command reports a missing/broken config, verify with `git show HEAD:<path>` or a direct tool invocation (`npx eslint`, `npx tsc`) before concluding anything is actually broken — never rewrite a config file based on wrapped output alone.
- Commit after every task.

---

### Task 1: Test infra + TanStack Query wiring

**Files:**
- Modify: `desktop/package.json`
- Create: `desktop/vitest.config.ts`
- Create: `desktop/src/test/setup.ts`
- Create: `desktop/src/test/queryWrapper.tsx`
- Create: `desktop/src/lib/queryClient.ts`
- Modify: `desktop/src/main.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `desktop`'s test command (`npm test -w idento-desktop`) and typecheck (`npm run typecheck -w idento-desktop`); `queryClient` (a configured `QueryClient` instance) wired into the app root; `createWrapper()` from `test/queryWrapper.tsx` — a `renderHook`/`render` wrapper providing a fresh `QueryClientProvider` per test (retries disabled), used by every later task's tests.

- [ ] **Step 1: Add dependencies and scripts**

In `desktop/package.json`, add to `dependencies`:

```json
    "@tanstack/react-query": "^5.101.2",
```

Add to `devDependencies`:

```json
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^25.0.1",
    "vitest": "^4.1.10",
```

Add to `scripts` (alongside the existing `dev`/`build`/`tauri`/`lint`):

```json
    "typecheck": "tsc -b",
    "test": "vitest run",
```

- [ ] **Step 2: Install**

```bash
npm install
```

Run from the repo root (workspace-wide lockfile).

- [ ] **Step 3: Create `desktop/vitest.config.ts`**

```ts
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react() as Plugin[]],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    passWithNoTests: true,
  },
});
```

- [ ] **Step 4: Create `desktop/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Create `desktop/src/lib/queryClient.ts`**

```ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
```

- [ ] **Step 6: Create `desktop/src/test/queryWrapper.tsx`**

```tsx
import type { PropsWithChildren, ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
```

- [ ] **Step 7: Wire `QueryClientProvider` into the app root**

Read `desktop/src/main.tsx` first, then replace its contents:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./i18n";
import App from "./App";
import { queryClient } from "./lib/queryClient";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 8: Verify**

```bash
npm test -w idento-desktop
npm run typecheck -w idento-desktop
npm run build -w idento-desktop
```

Expected: test run passes with 0 test files ("No test files found, exiting with code 0" — `passWithNoTests: true`); typecheck and build clean.

- [ ] **Step 9: Commit**

```bash
git add desktop/package.json package-lock.json desktop/vitest.config.ts desktop/src/test desktop/src/lib/queryClient.ts desktop/src/main.tsx
git commit -m "chore(desktop): add TanStack Query + vitest test infra"
```

---

### Task 2: Checkin domain types + verdict mapping

**Files:**
- Create: `desktop/src/features/checkin/types.ts`
- Create: `desktop/src/features/checkin/verdict.ts`
- Test: `desktop/src/features/checkin/verdict.test.ts`

**Interfaces:**
- Consumes: `Verdict` from `@idento/ui`.
- Produces:

```ts
// types.ts
export interface Attendee {
  id: string; event_id: string; first_name: string; last_name: string;
  email: string; company: string; position: string; code: string;
  checkin_status: boolean; checked_in_at: string | null;
  printed_count: number; blocked: boolean; block_reason: string | null;
  custom_fields?: Record<string, unknown>;
}
export type CheckinOutcome = "checked_in" | "already_checked_in" | "blocked";
export interface CheckinInfo { at: string; by_email: string; point_name: string | null }
export interface StationCheckinResponse { outcome: CheckinOutcome; attendee: Attendee; checkin: CheckinInfo | null }
export interface CheckinStation { id: string; event_id: string; name: string; zone_id: string | null; last_seen_at: string; created_at: string }
export interface CheckinActionAttendee { id: string; first_name: string; last_name: string; code: string }
export interface CheckinActionRow { id: string; action: "checkin" | "undo" | "reprint"; station_id: string | null; created_at: string; attendee: CheckinActionAttendee }

// verdict.ts
export type CheckinFlowOutcome = CheckinOutcome | "not_found";
export function outcomeToVerdict(outcome: CheckinFlowOutcome): Verdict;
```

- [ ] **Step 1: Create `types.ts`**

```ts
// Mirrors backend/openapi.yaml's Attendee/CheckinOutcome/StationCheckinResponse/
// CheckinStation/CheckinActionRow schemas verbatim (field names/nullability).
export interface Attendee {
  id: string;
  event_id: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  position: string;
  code: string;
  checkin_status: boolean;
  checked_in_at: string | null;
  printed_count: number;
  blocked: boolean;
  block_reason: string | null;
  custom_fields?: Record<string, unknown>;
}

// "not_found" is deliberately absent here -- it's a client-side outcome
// (verdict.ts's CheckinFlowOutcome), never returned by POST /checkin.
export type CheckinOutcome = "checked_in" | "already_checked_in" | "blocked";

export interface CheckinInfo {
  at: string;
  by_email: string;
  point_name: string | null;
}

export interface StationCheckinResponse {
  outcome: CheckinOutcome;
  attendee: Attendee;
  checkin: CheckinInfo | null;
}

export interface CheckinStation {
  id: string;
  event_id: string;
  name: string;
  zone_id: string | null;
  last_seen_at: string;
  created_at: string;
}

export interface CheckinActionAttendee {
  id: string;
  first_name: string;
  last_name: string;
  code: string;
}

export interface CheckinActionRow {
  id: string;
  action: "checkin" | "undo" | "reprint";
  station_id: string | null;
  created_at: string;
  attendee: CheckinActionAttendee;
}
```

- [ ] **Step 2: Write the failing test for `verdict.ts`**

```ts
import { describe, expect, it } from "vitest";
import { outcomeToVerdict } from "./verdict";

describe("outcomeToVerdict", () => {
  it.each([
    ["checked_in", "allowed"],
    ["already_checked_in", "already_checked_in"],
    ["blocked", "no_access"],
    ["not_found", "not_registered"],
  ] as const)("maps %s to %s", (outcome, verdict) => {
    expect(outcomeToVerdict(outcome)).toBe(verdict);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/features/checkin/verdict.test.ts`
Expected: FAIL (module `./verdict` not found).

- [ ] **Step 4: Create `verdict.ts`**

```ts
// Maps the check-in station's outcomes onto @idento/ui's Verdict vocabulary
// (VERDICTS/verdictClasses) instead of inventing station-specific colors.
// "not_found" never reaches POST /checkin -- it's produced client-side when
// the code lookup (useCheckinFlow.ts's submitCode) comes back empty.
import type { Verdict } from "@idento/ui";
import type { CheckinOutcome } from "./types";

export type CheckinFlowOutcome = CheckinOutcome | "not_found";

const OUTCOME_TO_VERDICT: Record<CheckinFlowOutcome, Verdict> = {
  checked_in: "allowed",
  already_checked_in: "already_checked_in",
  blocked: "no_access",
  not_found: "not_registered",
};

export function outcomeToVerdict(outcome: CheckinFlowOutcome): Verdict {
  return OUTCOME_TO_VERDICT[outcome];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w idento-desktop -- src/features/checkin/verdict.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Verify typecheck**

```bash
npm run typecheck -w idento-desktop
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/checkin/types.ts desktop/src/features/checkin/verdict.ts desktop/src/features/checkin/verdict.test.ts
git commit -m "feat(desktop): checkin domain types + outcome-to-verdict mapping"
```

---

### Task 3: Check-in settings parser

**Files:**
- Create: `desktop/src/features/checkin/settingsTypes.ts`
- Test: `desktop/src/features/checkin/settingsTypes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface CheckinSettings {
  print_on_checkin: boolean;
  verdict_auto_dismiss_sec: number;
  scan_input: "wedge" | "scanner" | "manual";
  manual_search_enabled: boolean;
}
export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings;
export function parseCheckinSettings(raw: unknown): CheckinSettings;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKIN_SETTINGS, parseCheckinSettings } from "./settingsTypes";

describe("parseCheckinSettings", () => {
  it("returns defaults for null", () => {
    expect(parseCheckinSettings(null)).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("returns defaults for a non-object", () => {
    expect(parseCheckinSettings("nope")).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("keeps valid fields, falls back per-field for invalid ones", () => {
    const result = parseCheckinSettings({
      print_on_checkin: false,
      verdict_auto_dismiss_sec: "not a number",
      scan_input: "scanner",
      manual_search_enabled: true,
    });
    expect(result).toEqual({
      print_on_checkin: false,
      verdict_auto_dismiss_sec: DEFAULT_CHECKIN_SETTINGS.verdict_auto_dismiss_sec,
      scan_input: "scanner",
      manual_search_enabled: true,
    });
  });

  it("rejects an invalid scan_input value, falls back to default", () => {
    expect(parseCheckinSettings({ scan_input: "camera" }).scan_input).toBe(DEFAULT_CHECKIN_SETTINGS.scan_input);
  });

  it("clamps verdict_auto_dismiss_sec to the 1..30 bound rather than discarding", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 1000 }).verdict_auto_dismiss_sec).toBe(30);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: -5 }).verdict_auto_dismiss_sec).toBe(1);
  });

  it("discards (not rounds) a fractional verdict_auto_dismiss_sec", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 4.5 }).verdict_auto_dismiss_sec).toBe(
      DEFAULT_CHECKIN_SETTINGS.verdict_auto_dismiss_sec,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/features/checkin/settingsTypes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `settingsTypes.ts`**

```ts
// Defensive parser for GET /api/events/{id}/checkin-settings' `settings:
// object | null` -- turns it into a fully-populated CheckinSettings so the
// rest of desktop never re-checks for null/partial/malformed data.
export interface CheckinSettings {
  print_on_checkin: boolean;
  verdict_auto_dismiss_sec: number;
  scan_input: "wedge" | "scanner" | "manual";
  manual_search_enabled: boolean;
}

export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings = {
  print_on_checkin: true,
  verdict_auto_dismiss_sec: 4,
  scan_input: "wedge",
  manual_search_enabled: true,
};

const VALID_SCAN_INPUTS: ReadonlySet<string> = new Set<CheckinSettings["scan_input"]>([
  "wedge",
  "scanner",
  "manual",
]);

const MIN_DISMISS_SEC = 1;
const MAX_DISMISS_SEC = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCheckinSettings(raw: unknown): CheckinSettings {
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_CHECKIN_SETTINGS };
  }

  const print_on_checkin =
    typeof raw.print_on_checkin === "boolean" ? raw.print_on_checkin : DEFAULT_CHECKIN_SETTINGS.print_on_checkin;

  const manual_search_enabled =
    typeof raw.manual_search_enabled === "boolean"
      ? raw.manual_search_enabled
      : DEFAULT_CHECKIN_SETTINGS.manual_search_enabled;

  const scan_input =
    typeof raw.scan_input === "string" && VALID_SCAN_INPUTS.has(raw.scan_input)
      ? (raw.scan_input as CheckinSettings["scan_input"])
      : DEFAULT_CHECKIN_SETTINGS.scan_input;

  let verdict_auto_dismiss_sec = DEFAULT_CHECKIN_SETTINGS.verdict_auto_dismiss_sec;
  if (
    typeof raw.verdict_auto_dismiss_sec === "number" &&
    Number.isFinite(raw.verdict_auto_dismiss_sec) &&
    Number.isInteger(raw.verdict_auto_dismiss_sec)
  ) {
    verdict_auto_dismiss_sec = Math.min(
      MAX_DISMISS_SEC,
      Math.max(MIN_DISMISS_SEC, raw.verdict_auto_dismiss_sec),
    );
  }

  return { print_on_checkin, verdict_auto_dismiss_sec, scan_input, manual_search_enabled };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/settingsTypes.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/features/checkin/settingsTypes.ts desktop/src/features/checkin/settingsTypes.test.ts
git commit -m "feat(desktop): defensive check-in settings parser"
```

---

### Task 4: Atomic scan-consume in the agent client

**Files:**
- Modify: `desktop/src/lib/agent.ts`
- Test: `desktop/src/lib/agent.test.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `agentPost`).
- Produces: `consumeLastScan(): Promise<{ code: string }>` exported from `lib/agent.ts`.

- [ ] **Step 1: Write the failing test**

Create `desktop/src/lib/agent.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeLastScan } from "./agent";

describe("consumeLastScan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs /scan/consume and returns the code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ code: "EVT-123", time: "2026-07-21T00:00:00Z" })),
    } as Response);

    const result = await consumeLastScan();

    expect(result).toEqual({ code: "EVT-123" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:12345/scan/consume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns an empty code when the buffer was empty", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ code: "", time: "0001-01-01T00:00:00Z" })),
    } as Response);

    expect(await consumeLastScan()).toEqual({ code: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/lib/agent.test.ts`
Expected: FAIL (`consumeLastScan` is not exported).

- [ ] **Step 3: Add `consumeLastScan` to `desktop/src/lib/agent.ts`**

Append to the end of the file (after `checkAgentHealth`):

```ts
// Atomic read+clear of the agent's scan buffer (agent/openapi.yaml's
// POST /scan/consume) -- unlike the older GET /scan/last + POST /scan/clear
// pair, a scan arriving between a separate read and clear can never be lost.
export async function consumeLastScan(): Promise<{ code: string }> {
  const text = await agentPost("/scan/consume");
  const data = JSON.parse(text) as { code?: string };
  return { code: data.code ?? "" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/lib/agent.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/agent.ts desktop/src/lib/agent.test.ts
git commit -m "feat(desktop): atomic scan-consume via agent POST /scan/consume"
```

---

### Task 5: Check-in loop data hooks (TanStack Query)

**Files:**
- Create: `desktop/src/features/checkin/hooks.ts`
- Test: `desktop/src/features/checkin/hooks.test.tsx`

**Interfaces:**
- Consumes: `api` from `../../lib/api`, `agentGet` from `../../lib/agent`, `checkAgentHealth` from `../../lib/agent`, `CheckinSettings`/`parseCheckinSettings` from `./settingsTypes`, types from `./types`, `createWrapper` from `../../test/queryWrapper` (tests only).
- Produces:

```ts
export function useEvent(eventId: string): UseQueryResult<{ id: string; name: string }>;
export function CHECKIN_SETTINGS_KEY(eventId: string): readonly ["checkin-settings", string];
export function useCheckinSettings(eventId: string): UseQueryResult<CheckinSettings>;
export function useSaveCheckinSettings(eventId: string): UseMutationResult<CheckinSettings, unknown, CheckinSettings>;
export function CHECKIN_STATIONS_KEY(eventId: string): readonly ["checkin-stations", string];
export function useCheckinStations(eventId: string): UseQueryResult<CheckinStation[]>;
export function useRegisterStation(eventId: string): UseMutationResult<CheckinStation, unknown, { name: string; zone_id?: string | null }>;
export function useStationHeartbeat(eventId: string): UseMutationResult<void, unknown, string>;
export function CHECKIN_ACTIONS_KEY(eventId: string): readonly ["checkin-actions", string];
export function useCheckinActions(eventId: string, limit?: number): UseQueryResult<CheckinActionRow[]>;
export function useStationCheckin(eventId: string): UseMutationResult<StationCheckinResponse, unknown, { attendee_id: string; station_id: string | null }>;
export function useMarkAttendeePrinted(): UseMutationResult<{ printed_count: number }, unknown, { attendeeId: string; eventId?: string; stationId?: string | null }>;
export function useAgentDefaultPrinter(): UseQueryResult<string | null>;
export function useAgentHealth(): UseQueryResult<boolean>;
```

- [ ] **Step 1: Write the failing tests**

Create `desktop/src/features/checkin/hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import * as agentLib from "../../lib/agent";
import { createWrapper } from "../../test/queryWrapper";
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinActions,
  useCheckinSettings,
  useCheckinStations,
  useEvent,
  useMarkAttendeePrinted,
  useRegisterStation,
  useSaveCheckinSettings,
  useStationCheckin,
  useStationHeartbeat,
} from "./hooks";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCheckinSettings", () => {
  it("parses the settings envelope", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { settings: { print_on_checkin: false, verdict_auto_dismiss_sec: 4, scan_input: "wedge", manual_search_enabled: true } } });
    const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.print_on_checkin).toBe(false);
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1/checkin-settings");
  });

  it("falls back to defaults when settings is null", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { settings: null } });
    const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.scan_input).toBe("wedge");
  });
});

describe("useSaveCheckinSettings", () => {
  it("PUTs the settings body", async () => {
    const settings = { print_on_checkin: true, verdict_auto_dismiss_sec: 10, scan_input: "manual" as const, manual_search_enabled: true };
    vi.spyOn(api, "put").mockResolvedValue({ data: { settings } });
    const { result } = renderHook(() => useSaveCheckinSettings("evt-1"), { wrapper: createWrapper() });
    await result.current.mutateAsync(settings);
    expect(api.put).toHaveBeenCalledWith("/api/events/evt-1/checkin-settings", { settings });
  });
});

describe("useCheckinStations / useRegisterStation", () => {
  it("lists stations", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { stations: [{ id: "s1", event_id: "evt-1", name: "Стойка 1", zone_id: null, last_seen_at: "t", created_at: "t" }] } });
    const { result } = renderHook(() => useCheckinStations("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("registers a station", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { station: { id: "s1", event_id: "evt-1", name: "Стойка 1", zone_id: null, last_seen_at: "t", created_at: "t" } } });
    const { result } = renderHook(() => useRegisterStation("evt-1"), { wrapper: createWrapper() });
    const station = await result.current.mutateAsync({ name: "Стойка 1" });
    expect(station.id).toBe("s1");
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin-stations", { name: "Стойка 1" });
  });
});

describe("useStationHeartbeat", () => {
  it("POSTs the heartbeat for a station id", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useStationHeartbeat("evt-1"), { wrapper: createWrapper() });
    await result.current.mutateAsync("s1");
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin-stations/s1/heartbeat");
  });
});

describe("useCheckinActions", () => {
  it("GETs the feed with a limit query param", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { actions: [] } });
    const { result } = renderHook(() => useCheckinActions("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1/checkin-actions", { params: { limit: 50 } });
  });
});

describe("useStationCheckin", () => {
  it("POSTs attendee_id + station_id and returns the outcome", async () => {
    const response = { outcome: "checked_in", attendee: { id: "a1" }, checkin: { at: "t", by_email: "x", point_name: null } };
    vi.spyOn(api, "post").mockResolvedValue({ data: response });
    const { result } = renderHook(() => useStationCheckin("evt-1"), { wrapper: createWrapper() });
    const data = await result.current.mutateAsync({ attendee_id: "a1", station_id: "s1" });
    expect(data.outcome).toBe("checked_in");
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin", { attendee_id: "a1", station_id: "s1" });
  });
});

describe("useMarkAttendeePrinted", () => {
  it("sends no body when eventId is omitted (back-compat counter-only path)", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { printed_count: 3 } });
    const { result } = renderHook(() => useMarkAttendeePrinted(), { wrapper: createWrapper() });
    await result.current.mutateAsync({ attendeeId: "a1" });
    expect(api.post).toHaveBeenCalledWith("/api/attendees/a1/printed", undefined);
  });

  it("sends event_id + station_id when present (reprint audit path)", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { printed_count: 4 } });
    const { result } = renderHook(() => useMarkAttendeePrinted(), { wrapper: createWrapper() });
    await result.current.mutateAsync({ attendeeId: "a1", eventId: "evt-1", stationId: "s1" });
    expect(api.post).toHaveBeenCalledWith("/api/attendees/a1/printed", { event_id: "evt-1", station_id: "s1" });
  });
});

describe("useAgentDefaultPrinter", () => {
  it("parses the agent's default-printer response", async () => {
    vi.spyOn(agentLib, "agentGet").mockResolvedValue(JSON.stringify({ default: "Zebra_Gate" }));
    const { result } = renderHook(() => useAgentDefaultPrinter(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("Zebra_Gate");
  });

  it("resolves null when the agent has no default printer", async () => {
    vi.spyOn(agentLib, "agentGet").mockResolvedValue(JSON.stringify({ default: null }));
    const { result } = renderHook(() => useAgentDefaultPrinter(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useAgentHealth", () => {
  it("resolves the agent's health check", async () => {
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(true);
    const { result } = renderHook(() => useAgentHealth(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });
});

describe("useEvent", () => {
  it("GETs the event by id", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { id: "evt-1", name: "Технопром-2026" } });
    const { result } = renderHook(() => useEvent("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Технопром-2026");
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/features/checkin/hooks.test.tsx`
Expected: FAIL (module `./hooks` not found).

- [ ] **Step 3: Create `desktop/src/features/checkin/hooks.ts`**

```ts
// TanStack Query wrappers over the existing axios instance (lib/api.ts) for
// the backend's server-side check-in loop (P4.1), and over the local
// hardware agent's default-printer probe. Mirrors panel/src/features/
// checkin/hooks.ts's query-key/invalidation shape, hand-typed against axios
// instead of openapi-fetch (desktop has no generated typed client).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { agentGet, checkAgentHealth } from "../../lib/agent";
import { parseCheckinSettings, type CheckinSettings } from "./settingsTypes";
import type { CheckinActionRow, CheckinStation, StationCheckinResponse } from "./types";

// ---------------------------------------------------------------------------
// Event -- GET /api/events/{id}. Only the fields this feature needs.
// ---------------------------------------------------------------------------

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      const { data } = await api.get<{ id: string; name: string }>(`/api/events/${eventId}`);
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in settings -- GET/PUT /api/events/{id}/checkin-settings. Path param
// is `id`, not `event_id` (openapi.yaml's own spelling for this operation).
// ---------------------------------------------------------------------------

export function CHECKIN_SETTINGS_KEY(eventId: string) {
  return ["checkin-settings", eventId] as const;
}

export function useCheckinSettings(eventId: string) {
  return useQuery({
    queryKey: CHECKIN_SETTINGS_KEY(eventId),
    queryFn: async () => {
      const { data } = await api.get<{ settings: CheckinSettings | null }>(`/api/events/${eventId}/checkin-settings`);
      return parseCheckinSettings(data.settings);
    },
  });
}

export function useSaveCheckinSettings(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: CheckinSettings) => {
      const { data } = await api.put<{ settings: CheckinSettings | null }>(`/api/events/${eventId}/checkin-settings`, { settings });
      return parseCheckinSettings(data.settings);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CHECKIN_SETTINGS_KEY(eventId), data);
      void queryClient.invalidateQueries({ queryKey: CHECKIN_SETTINGS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in stations -- register / heartbeat / list
// (/api/events/{event_id}/checkin-stations*).
// ---------------------------------------------------------------------------

export function CHECKIN_STATIONS_KEY(eventId: string) {
  return ["checkin-stations", eventId] as const;
}

export function useCheckinStations(eventId: string) {
  return useQuery({
    queryKey: CHECKIN_STATIONS_KEY(eventId),
    queryFn: async () => {
      const { data } = await api.get<{ stations: CheckinStation[] }>(`/api/events/${eventId}/checkin-stations`);
      return data.stations;
    },
  });
}

export function useRegisterStation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; zone_id?: string | null }) => {
      const { data } = await api.post<{ station: CheckinStation }>(`/api/events/${eventId}/checkin-stations`, body);
      return data.station;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY(eventId) });
    },
  });
}

export function useStationHeartbeat(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stationId: string) => {
      await api.post(`/api/events/${eventId}/checkin-stations/${stationId}/heartbeat`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in actions feed -- GET /api/events/{event_id}/checkin-actions.
// ---------------------------------------------------------------------------

export function CHECKIN_ACTIONS_KEY(eventId: string) {
  return ["checkin-actions", eventId] as const;
}

export function useCheckinActions(eventId: string, limit = 50) {
  return useQuery({
    queryKey: [...CHECKIN_ACTIONS_KEY(eventId), limit],
    queryFn: async () => {
      const { data } = await api.get<{ actions: CheckinActionRow[] }>(`/api/events/${eventId}/checkin-actions`, {
        params: { limit },
      });
      return data.actions;
    },
  });
}

// ---------------------------------------------------------------------------
// Station check-in -- POST /api/events/{event_id}/checkin.
// ---------------------------------------------------------------------------

export function useStationCheckin(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { attendee_id: string; station_id: string | null }) => {
      const { data } = await api.post<StationCheckinResponse>(`/api/events/${eventId}/checkin`, body);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Print-counter bump + optional reprint audit -- POST /api/attendees/{id}/printed.
// A body is sent only when eventId is present -- an absent body is the
// pre-existing counter-only back-compat path (no checkin_actions row).
// ---------------------------------------------------------------------------

export function useMarkAttendeePrinted() {
  return useMutation({
    mutationFn: async ({ attendeeId, eventId, stationId }: { attendeeId: string; eventId?: string; stationId?: string | null }) => {
      const { data } = await api.post<{ printed_count: number }>(
        `/api/attendees/${attendeeId}/printed`,
        eventId ? { event_id: eventId, station_id: stationId ?? null } : undefined,
      );
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Agent default printer -- GET /printers/default (agent, not backend).
// ---------------------------------------------------------------------------

export function useAgentDefaultPrinter() {
  return useQuery({
    queryKey: ["agent", "default-printer"],
    queryFn: async () => {
      const text = await agentGet("/printers/default");
      const parsed = JSON.parse(text) as { default?: string | null };
      return parsed.default ?? null;
    },
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Agent health -- GET /health (agent, not backend).
// ---------------------------------------------------------------------------

export function useAgentHealth() {
  return useQuery({
    queryKey: ["agent", "health"],
    queryFn: checkAgentHealth,
    refetchInterval: 20_000,
    retry: false,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/hooks.test.tsx`
Expected: PASS (14/14).

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck -w idento-desktop
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/checkin/hooks.ts desktop/src/features/checkin/hooks.test.tsx
git commit -m "feat(desktop): TanStack Query hooks for the server-side check-in loop"
```

---

### Task 6: Station heartbeat lifecycle

**Files:**
- Create: `desktop/src/features/checkin/useHeartbeat.ts`
- Test: `desktop/src/features/checkin/useHeartbeat.test.tsx`

**Interfaces:**
- Consumes: `useStationHeartbeat` from `./hooks`, `createWrapper` from `../../test/queryWrapper`.
- Produces: `useHeartbeat(eventId: string, stationId: string | null): void`.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { createWrapper } from "../../test/queryWrapper";
import { useHeartbeat } from "./useHeartbeat";

describe("useHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("beats immediately on mount, then every 20s, for a registered station", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: undefined });
    renderHook(() => useHeartbeat("evt-1", "s1"), { wrapper: createWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin-stations/s1/heartbeat");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("does nothing when stationId is null", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: undefined });
    renderHook(() => useHeartbeat("evt-1", null), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/features/checkin/useHeartbeat.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `useHeartbeat.ts`**

```ts
// Keeps a registered station's last_seen_at fresh for as long as this hook
// stays mounted: an immediate heartbeat on mount, then every 20s. A failed
// heartbeat is non-fatal (fire-and-forget `.mutate()`) -- useConnectionState
// owns surfacing a persistent failure, this hook just keeps trying.
import { useEffect, useRef } from "react";
import { useStationHeartbeat } from "./hooks";

const HEARTBEAT_INTERVAL_MS = 20_000;

export function useHeartbeat(eventId: string, stationId: string | null): void {
  const heartbeat = useStationHeartbeat(eventId);

  const mutateRef = useRef(heartbeat.mutate);
  useEffect(() => {
    mutateRef.current = heartbeat.mutate;
  }, [heartbeat.mutate]);

  useEffect(() => {
    if (!stationId) return;
    const activeStationId = stationId;

    function beat() {
      mutateRef.current(activeStationId);
    }

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [eventId, stationId]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/useHeartbeat.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/features/checkin/useHeartbeat.ts desktop/src/features/checkin/useHeartbeat.test.tsx
git commit -m "feat(desktop): station heartbeat hook (20s interval)"
```

---

### Task 7: Connection/degraded-mode signal

**Files:**
- Create: `desktop/src/features/checkin/useConnectionState.ts`
- Test: `desktop/src/features/checkin/useConnectionState.test.tsx`

**Interfaces:**
- Consumes: `useCheckinActions` from `./hooks`, `createWrapper` from `../../test/queryWrapper`.
- Produces: `useConnectionState(eventId: string): { online: boolean }`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { createWrapper } from "../../test/queryWrapper";
import { useConnectionState } from "./useConnectionState";

describe("useConnectionState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports online when the browser is online and the feed query succeeds", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { actions: [] } });
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(500);
    expect(result.current.online).toBe(true);
  });

  it("reports offline (after the debounce) when the browser fires offline", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { actions: [] } });
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(500);
    expect(result.current.online).toBe(true);

    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(399);
    expect(result.current.online).toBe(true); // still within the 400ms debounce window
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => expect(result.current.online).toBe(false));
  });

  it("reports offline when the feed query errors, even though navigator.onLine is true", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(result.current.online).toBe(false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/features/checkin/useConnectionState.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `useConnectionState.ts`**

```ts
// Two independent failure modes, folded into one debounced boolean: (1) the
// browser itself is offline (navigator.onLine + window online/offline
// events), (2) the backend is unreachable even though the browser thinks it
// has a network path -- read off the SAME checkin-actions feed query every
// other consumer already mounts (its own retries settle isError). Debounced
// 400ms so a single missed beat can't flap the banner on/off. A 20s
// self-refetch keeps the signal honest even with no other observer forcing
// a refetch.
import { useEffect, useRef, useState } from "react";
import { useCheckinActions } from "./hooks";

export interface UseConnectionStateResult {
  online: boolean;
}

const DEBOUNCE_MS = 400;
const HEALTH_POLL_INTERVAL_MS = 20_000;

function readNavigatorOnline(): boolean {
  return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? true : navigator.onLine;
}

export function useConnectionState(eventId: string): UseConnectionStateResult {
  const actionsQuery = useCheckinActions(eventId);

  const [browserOnline, setBrowserOnline] = useState(readNavigatorOnline);

  useEffect(() => {
    function handleOnline() {
      setBrowserOnline(true);
    }
    function handleOffline() {
      setBrowserOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const refetchRef = useRef(actionsQuery.refetch);
  useEffect(() => {
    refetchRef.current = actionsQuery.refetch;
  }, [actionsQuery.refetch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refetchRef.current();
    }, HEALTH_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const rawOnline = browserOnline && !actionsQuery.isError;

  const [online, setOnline] = useState(rawOnline);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setOnline(rawOnline), DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [rawOnline]);

  return { online };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/useConnectionState.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/features/checkin/useConnectionState.ts desktop/src/features/checkin/useConnectionState.test.tsx
git commit -m "feat(desktop): debounced online/degraded connection signal"
```

---

### Task 8: Scan input (wedge / scanner / manual)

**Files:**
- Create: `desktop/src/features/checkin/useScanInput.ts`
- Test: `desktop/src/features/checkin/useScanInput.test.tsx`

**Interfaces:**
- Consumes: `consumeLastScan` from `../../lib/agent`.
- Produces:

```ts
export type ScanInputMode = "wedge" | "scanner" | "manual";
export interface WedgeInputProps {
  ref: React.RefObject<HTMLInputElement | null>;
  value: string;
  disabled: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}
export interface UseScanInputResult { degraded: boolean; wedgeInputProps: WedgeInputProps }
export function useScanInput(options: { mode: ScanInputMode; onCode(code: string): void; enabled: boolean }): UseScanInputResult;
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as agentLib from "../../lib/agent";
import { useScanInput } from "./useScanInput";

function WedgeHarness({ onCode, enabled = true }: { onCode: (code: string) => void; enabled?: boolean }) {
  const { wedgeInputProps } = useScanInput({ mode: "wedge", onCode, enabled });
  return <input aria-label="wedge-capture" {...wedgeInputProps} />;
}

describe("useScanInput — wedge mode", () => {
  it("fires onCode on Enter and clears the buffer", async () => {
    const user = userEvent.setup();
    const onCode = vi.fn();
    render(<WedgeHarness onCode={onCode} />);
    const input = screen.getByLabelText("wedge-capture");
    await user.type(input, "EVT-42{Enter}");
    expect(onCode).toHaveBeenCalledWith("EVT-42");
    expect(input).toHaveValue("");
  });

  it("does not fire onCode for an empty Enter", async () => {
    const user = userEvent.setup();
    const onCode = vi.fn();
    render(<WedgeHarness onCode={onCode} />);
    await user.type(screen.getByLabelText("wedge-capture"), "{Enter}");
    expect(onCode).not.toHaveBeenCalled();
  });
});

describe("useScanInput — scanner mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function ScannerHarness({ onCode }: { onCode: (code: string) => void }) {
    const { degraded } = useScanInput({ mode: "scanner", onCode, enabled: true });
    return <div data-testid="degraded">{String(degraded)}</div>;
  }

  it("polls consumeLastScan every 200ms and fires onCode on a non-empty result", async () => {
    const onCode = vi.fn();
    vi.spyOn(agentLib, "consumeLastScan").mockResolvedValue({ code: "EVT-1" });
    render(<ScannerHarness onCode={onCode} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(onCode).toHaveBeenCalledWith("EVT-1");
  });

  it("sets degraded when the agent poll fails", async () => {
    const onCode = vi.fn();
    vi.spyOn(agentLib, "consumeLastScan").mockRejectedValue(new Error("agent unreachable"));
    render(<ScannerHarness onCode={onCode} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("degraded")).toHaveTextContent("true");
  });
});

describe("useScanInput — manual mode", () => {
  it("wedgeInputProps.disabled is true (no auto-input at all)", () => {
    function ManualHarness() {
      const { wedgeInputProps } = useScanInput({ mode: "manual", onCode: () => {}, enabled: true });
      return <input aria-label="wedge-capture" {...wedgeInputProps} />;
    }
    render(<ManualHarness />);
    expect(screen.getByLabelText("wedge-capture")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/features/checkin/useScanInput.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `useScanInput.ts`**

```ts
// Three scan-input modes unified behind one hook:
// wedge: a USB/keyboard-wedge scanner "types" into whatever has focus, then
//   sends Enter -- own a hidden always-focused text input, Enter is the scan
//   boundary.
// scanner: a handheld scanner the AGENT talks to over serial/USB -- poll its
//   atomic scan-consume buffer.
// manual: no auto-input at all; the caller's own search box is the only path.
import { useEffect, useRef, useState } from "react";
import { consumeLastScan } from "../../lib/agent";

export type ScanInputMode = "wedge" | "scanner" | "manual";

export interface UseScanInputOptions {
  mode: ScanInputMode;
  onCode(code: string): void;
  // Gates both wedge capture and scanner polling -- callers pass false
  // while a previous scan is still resolving so a double-fire can't race an
  // in-flight check-in.
  enabled: boolean;
}

export interface WedgeInputProps {
  ref: React.RefObject<HTMLInputElement | null>;
  value: string;
  disabled: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

export interface UseScanInputResult {
  // True only in scanner mode, only once consumeLastScan() itself has
  // failed -- hints the caller toward a manual-search fallback.
  degraded: boolean;
  wedgeInputProps: WedgeInputProps;
}

const SCANNER_POLL_INTERVAL_MS = 200;
const WEDGE_REFOCUS_DELAY_MS = 50;

function isDeliberateFocusTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null;
}

export function useScanInput({ mode, onCode, enabled }: UseScanInputOptions): UseScanInputResult {
  const [degraded, setDegraded] = useState(false);
  const [wedgeValue, setWedgeValue] = useState("");
  const wedgeRef = useRef<HTMLInputElement>(null);

  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const wedgeActive = mode === "wedge" && enabled;
  const wedgeActiveRef = useRef(wedgeActive);
  wedgeActiveRef.current = wedgeActive;

  useEffect(() => {
    if (!wedgeActive) return;
    wedgeRef.current?.focus();
  }, [wedgeActive]);

  const refocusTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(refocusTimerRef.current), []);

  function handleWedgeBlur() {
    if (!wedgeActiveRef.current) return;
    window.clearTimeout(refocusTimerRef.current);
    refocusTimerRef.current = window.setTimeout(() => {
      if (!wedgeActiveRef.current) return;
      if (isDeliberateFocusTarget(document.activeElement)) return;
      wedgeRef.current?.focus();
    }, WEDGE_REFOCUS_DELAY_MS);
  }

  function handleWedgeChange(event: React.ChangeEvent<HTMLInputElement>) {
    setWedgeValue(event.target.value);
  }

  function handleWedgeKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = wedgeValue.trim();
    setWedgeValue("");
    wedgeRef.current?.focus();
    if (code) onCodeRef.current(code);
  }

  useEffect(() => {
    if (mode !== "scanner" || !enabled) {
      setDegraded(false);
      return;
    }

    let cancelled = false;
    let pollInFlight = false;

    async function poll() {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const scan = await consumeLastScan();
        if (cancelled) return;
        setDegraded(false);
        if (scan.code) onCodeRef.current(scan.code);
      } catch {
        if (!cancelled) setDegraded(true);
      } finally {
        pollInFlight = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), SCANNER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mode, enabled]);

  return {
    degraded,
    wedgeInputProps: {
      ref: wedgeRef,
      value: wedgeValue,
      disabled: !wedgeActive,
      onChange: handleWedgeChange,
      onKeyDown: handleWedgeKeyDown,
      onBlur: handleWedgeBlur,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/useScanInput.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/features/checkin/useScanInput.ts desktop/src/features/checkin/useScanInput.test.tsx
git commit -m "feat(desktop): scan input hook (wedge/scanner/manual)"
```

---

### Task 9: Check-in flow state machine

**Files:**
- Create: `desktop/src/features/checkin/useCheckinFlow.ts`
- Test: `desktop/src/features/checkin/useCheckinFlow.test.tsx`

**Interfaces:**
- Consumes: `api` from `../../lib/api`, `agentPost` from `../../lib/agent`, `Verdict` from `@idento/ui`, `Attendee`/`CheckinInfo` from `./types`, `useStationCheckin`/`useMarkAttendeePrinted` from `./hooks`, `CheckinSettings` from `./settingsTypes`, `outcomeToVerdict` from `./verdict`, `createWrapper` from `../../test/queryWrapper`.
- Produces:

```ts
export interface CheckinFlowState {
  status: "idle" | "resolving" | "verdict";
  verdict?: Verdict;
  attendee?: Attendee;
  checkin?: CheckinInfo | null;
  printError?: unknown;
  requestError?: unknown;
}
export interface UseCheckinFlowResult {
  state: CheckinFlowState;
  submitCode(code: string): Promise<void>;
  submitAttendee(attendee: Attendee): Promise<void>;
  printCurrent(): Promise<void>;
  clear(): void;
}
export function useCheckinFlow(options: { eventId: string; stationId: string | null; settings: CheckinSettings; printerName: string }): UseCheckinFlowResult;
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import * as agentLib from "../../lib/agent";
import { createWrapper } from "../../test/queryWrapper";
import type { Attendee } from "./types";
import { useCheckinFlow } from "./useCheckinFlow";

const attendee: Attendee = {
  id: "a1",
  event_id: "evt-1",
  first_name: "Alice",
  last_name: "Doe",
  email: "alice@example.com",
  company: "Acme",
  position: "Staff",
  code: "EVT-1",
  checkin_status: false,
  checked_in_at: null,
  printed_count: 0,
  blocked: false,
  block_reason: null,
};

const baseSettings = { print_on_checkin: true, verdict_auto_dismiss_sec: 4, scan_input: "wedge" as const, manual_search_enabled: true };

function setup(settingsOverride: Partial<typeof baseSettings> = {}) {
  return renderHook(
    () => useCheckinFlow({ eventId: "evt-1", stationId: "s1", settings: { ...baseSettings, ...settingsOverride }, printerName: "Zebra_Gate" }),
    { wrapper: createWrapper() },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useCheckinFlow.submitCode", () => {
  it("resolves not_registered client-side when the code lookup is empty", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [] });
    const { result } = setup();
    await act(() => result.current.submitCode("NOPE"));
    expect(result.current.state.status).toBe("verdict");
    expect(result.current.state.verdict).toBe("not_registered");
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1/attendees", { params: { code: "NOPE" } });
  });

  it("checks in a found attendee and auto-prints on checked_in", async () => {
    vi.spyOn(api, "get").mockImplementation((url: string) => {
      if (url.includes("/attendees")) return Promise.resolve({ data: [attendee] });
      return Promise.reject(new Error("unexpected GET " + url));
    });
    vi.spyOn(api, "post").mockImplementation((url: string) => {
      if (url.endsWith("/checkin")) return Promise.resolve({ data: { outcome: "checked_in", attendee, checkin: { at: "t", by_email: "x", point_name: null } } });
      if (url.endsWith("/badge-zpl")) return Promise.resolve({ data: { zpl: "^XA^XZ" } });
      if (url.endsWith("/printed")) return Promise.resolve({ data: { printed_count: 1 } });
      return Promise.reject(new Error("unexpected POST " + url));
    });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup();
    await act(() => result.current.submitCode("EVT-1"));

    expect(result.current.state.verdict).toBe("allowed");
    expect(agentPostSpy).toHaveBeenCalledWith("/print", JSON.stringify({ printer_name: "Zebra_Gate", zpl: "^XA^XZ" }));
    expect(api.post).toHaveBeenCalledWith("/api/attendees/a1/printed", undefined); // auto-print: no reprint audit
  });

  it("does not auto-print when print_on_checkin is false", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "checked_in", attendee, checkin: null } });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup({ print_on_checkin: false });
    await act(() => result.current.submitCode("EVT-1"));

    expect(result.current.state.verdict).toBe("allowed");
    expect(agentPostSpy).not.toHaveBeenCalled();
  });

  it("never auto-prints on already_checked_in, and never auto-dismisses it", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "already_checked_in", attendee, checkin: { at: "t", by_email: "x", point_name: null } } });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup();
    await act(() => result.current.submitCode("EVT-1"));

    expect(result.current.state.verdict).toBe("already_checked_in");
    expect(agentPostSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.state.status).toBe("verdict"); // still waiting for the operator
  });

  it("auto-dismisses an allowed verdict after verdict_auto_dismiss_sec", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "checked_in", attendee, checkin: null } });
    vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup({ print_on_checkin: false, verdict_auto_dismiss_sec: 4 });
    await act(() => result.current.submitCode("EVT-1"));
    expect(result.current.state.status).toBe("verdict");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(result.current.state.status).toBe("idle");
  });

  it("ignores a second submitCode while one is already resolving (re-entrancy guard)", async () => {
    let resolveGet: (value: { data: Attendee[] }) => void = () => {};
    vi.spyOn(api, "get").mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

    const { result } = setup();
    const first = act(() => result.current.submitCode("EVT-1"));
    await act(() => result.current.submitCode("EVT-1")); // dropped, busyRef is set

    expect(api.get).toHaveBeenCalledTimes(1);
    resolveGet({ data: [] });
    await first;
  });

  it("resets to idle and records requestError on a network failure", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("network down"));
    const { result } = setup();
    await act(async () => {
      await result.current.submitCode("EVT-1").catch(() => {});
    });
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.requestError).toBeInstanceOf(Error);
  });
});

describe("useCheckinFlow.printCurrent", () => {
  it("no-ops when the current verdict is not allowed", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "blocked", attendee, checkin: null } });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup();
    await act(() => result.current.submitCode("EVT-1"));
    expect(result.current.state.verdict).toBe("no_access");

    agentPostSpy.mockClear();
    await act(() => result.current.printCurrent());
    expect(agentPostSpy).not.toHaveBeenCalled();
  });

  it("prints with a reprint audit (event_id + station_id) when the operator taps Печать", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    const postSpy = vi.spyOn(api, "post").mockImplementation((url: string) => {
      if (url.endsWith("/checkin")) return Promise.resolve({ data: { outcome: "checked_in", attendee, checkin: null } });
      if (url.endsWith("/badge-zpl")) return Promise.resolve({ data: { zpl: "^XA^XZ" } });
      if (url.endsWith("/printed")) return Promise.resolve({ data: { printed_count: 2 } });
      return Promise.reject(new Error("unexpected POST " + url));
    });
    vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup({ print_on_checkin: false }); // no auto-print, so the button is the only print path
    await act(() => result.current.submitCode("EVT-1"));
    postSpy.mockClear();

    await act(() => result.current.printCurrent());
    expect(postSpy).toHaveBeenCalledWith("/api/attendees/a1/printed", { event_id: "evt-1", station_id: "s1" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/features/checkin/useCheckinFlow.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `useCheckinFlow.ts`**

```ts
// The check-in station's core state machine. Resolves a scanned code
// (submitCode) or a manually-picked attendee (submitAttendee) to one of the
// four station outcomes (verdict.ts's outcomeToVerdict), fires the
// idempotent check-in mutation, and -- ONLY on the server's own "checked_in"
// outcome, and ONLY when settings.print_on_checkin -- auto-prints via the
// agent. printCurrent is the separate, always-available manual "Печать"
// path (VerdictScreen renders it only when the auto-print didn't already
// fire) -- unlike the auto path, it always passes event_id/station_id to
// markAttendeePrinted, logging a genuine `reprint` audit row.
import { useEffect, useRef, useState } from "react";
import type { Verdict } from "@idento/ui";
import { agentPost } from "../../lib/agent";
import { api } from "../../lib/api";
import { useMarkAttendeePrinted, useStationCheckin } from "./hooks";
import type { CheckinSettings } from "./settingsTypes";
import type { Attendee, CheckinInfo } from "./types";
import { outcomeToVerdict } from "./verdict";

export interface UseCheckinFlowOptions {
  eventId: string;
  stationId: string | null;
  settings: CheckinSettings;
  printerName: string;
}

export interface CheckinFlowState {
  status: "idle" | "resolving" | "verdict";
  verdict?: Verdict;
  attendee?: Attendee;
  checkin?: CheckinInfo | null;
  printError?: unknown;
  requestError?: unknown;
}

export interface UseCheckinFlowResult {
  state: CheckinFlowState;
  submitCode(code: string): Promise<void>;
  submitAttendee(attendee: Attendee): Promise<void>;
  printCurrent(): Promise<void>;
  clear(): void;
}

const IDLE_STATE: CheckinFlowState = { status: "idle" };

async function printAttendeeBadge(eventId: string, attendee: Attendee, printerName: string): Promise<void> {
  const { data } = await api.post<{ zpl: string }>(`/api/events/${eventId}/badge-zpl`, { attendee_id: attendee.id });
  await agentPost("/print", JSON.stringify({ printer_name: printerName, zpl: data.zpl }));
}

export function useCheckinFlow({ eventId, stationId, settings, printerName }: UseCheckinFlowOptions): UseCheckinFlowResult {
  const [state, setState] = useState<CheckinFlowState>(IDLE_STATE);
  const stationCheckin = useStationCheckin(eventId);
  const markPrinted = useMarkAttendeePrinted();

  const dismissTimerRef = useRef<number | undefined>(undefined);
  const busyRef = useRef(false);

  const clearDismissTimer = () => {
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = undefined;
  };

  useEffect(() => clearDismissTimer, []);

  const scheduleAutoDismiss = (verdict: Verdict) => {
    clearDismissTimer();
    // "already_checked_in" never auto-dismisses -- the operator decides.
    if (verdict === "already_checked_in") return;
    dismissTimerRef.current = window.setTimeout(() => {
      setState(IDLE_STATE);
    }, settings.verdict_auto_dismiss_sec * 1000);
  };

  const clear = () => {
    clearDismissTimer();
    setState(IDLE_STATE);
  };

  useEffect(() => {
    busyRef.current = false;
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, stationId]);

  async function resolveCheckin(attendee: Attendee): Promise<void> {
    const response = await stationCheckin.mutateAsync({ attendee_id: attendee.id, station_id: stationId });

    let printError: unknown;
    if (response.outcome === "checked_in" && settings.print_on_checkin) {
      try {
        await printAttendeeBadge(eventId, response.attendee, printerName);
        // Deliberately no event_id/station_id: the check-in itself already
        // logged the `checkin` feed row. Passing them would double-log a
        // `reprint` row for the same check-in.
        await markPrinted.mutateAsync({ attendeeId: response.attendee.id });
      } catch (error) {
        printError = error;
      }
    }

    const verdict = outcomeToVerdict(response.outcome);
    setState({ status: "verdict", verdict, attendee: response.attendee, checkin: response.checkin, printError });
    scheduleAutoDismiss(verdict);
  }

  async function submitCode(code: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    clearDismissTimer();
    setState({ status: "resolving" });
    try {
      const { data } = await api.get<Attendee[]>(`/api/events/${eventId}/attendees`, { params: { code } });
      const attendee = Array.isArray(data) ? data[0] : undefined;

      if (!attendee) {
        const verdict = outcomeToVerdict("not_found");
        setState({ status: "verdict", verdict });
        scheduleAutoDismiss(verdict);
        return;
      }

      await resolveCheckin(attendee);
    } catch (error) {
      setState({ status: "idle", requestError: error });
      throw error;
    } finally {
      busyRef.current = false;
    }
  }

  async function submitAttendee(attendee: Attendee): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    clearDismissTimer();
    setState({ status: "resolving" });
    try {
      await resolveCheckin(attendee);
    } catch (error) {
      setState({ status: "idle", requestError: error });
      throw error;
    } finally {
      busyRef.current = false;
    }
  }

  async function printCurrent(): Promise<void> {
    if (state.status !== "verdict" || state.verdict !== "allowed" || !state.attendee) return;
    const currentAttendee = state.attendee;
    try {
      await printAttendeeBadge(eventId, currentAttendee, printerName);
      await markPrinted.mutateAsync({ attendeeId: currentAttendee.id, eventId, stationId });
      setState((prev) => (prev.status === "verdict" ? { ...prev, printError: undefined } : prev));
    } catch (error) {
      setState((prev) => (prev.status === "verdict" ? { ...prev, printError: error } : prev));
    }
  }

  return { state, submitCode, submitAttendee, printCurrent, clear };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/useCheckinFlow.test.tsx`
Expected: PASS (9/9).

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck -w idento-desktop
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/checkin/useCheckinFlow.ts desktop/src/features/checkin/useCheckinFlow.test.tsx
git commit -m "feat(desktop): check-in flow state machine (submitCode/submitAttendee/printCurrent)"
```

---

### Task 10: Pre-flight steps rail + Connection/Login/QRLogin restyle

**Files:**
- Create: `desktop/src/features/preflight/steps.ts`
- Modify: `desktop/src/pages/Connection.tsx`
- Modify: `desktop/src/pages/Login.tsx`
- Modify: `desktop/src/pages/QRLogin.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: `PreflightShell`/`KioskButton`/`KioskInput` from `@idento/ui/kiosk`.
- Produces: `usePreflightSteps(): { label: string }[]` (5 labels: Подключение/Вход/Оборудование/Событие/Режим), consumed by every pre-flight page from here through Task 12.

This task is a visual port only — every page's state, API calls, and navigation logic are unchanged; only the JSX/markup and imports change. No new tests (behavior is identical to the existing pages, which have no tests today); verify by reading the diff and running typecheck/build.

- [ ] **Step 1: Create `desktop/src/features/preflight/steps.ts`**

```ts
import { useTranslation } from "react-i18next";

export interface PreflightStepDef {
  label: string;
}

export function usePreflightSteps(): PreflightStepDef[] {
  const { t } = useTranslation();
  return [
    { label: t("preflightStepConnection") },
    { label: t("preflightStepLogin") },
    { label: t("preflightStepEquipment") },
    { label: t("preflightStepEvent") },
    { label: t("preflightStepMode") },
  ];
}
```

- [ ] **Step 2: Add the new translation keys**

In `desktop/src/i18n.ts`, add to the `en.translation` object (near the top, after `appName`):

```ts
        preflightStepConnection: "Connection",
        preflightStepLogin: "Login",
        preflightStepEquipment: "Equipment",
        preflightStepEvent: "Event",
        preflightStepMode: "Mode",
```

Add to `ru.translation` in the same relative position:

```ts
        preflightStepConnection: "Подключение",
        preflightStepLogin: "Вход",
        preflightStepEquipment: "Оборудование",
        preflightStepEvent: "Событие",
        preflightStepMode: "Режим",
```

- [ ] **Step 3: Rewrite `desktop/src/pages/Connection.tsx`**

Read the file first (state/logic is preserved verbatim — `url`/`status`/`message` state, `checkConnection`, `save`, the mount effect), then replace its contents:

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { getBackendUrl, setBackendUrl } from "@/lib/config";
import { api } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";

export default function ConnectionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [url, setUrl] = useState(getBackendUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  const checkConnection = async () => {
    setStatus("checking");
    setMessage("");
    try {
      const base = url.trim().replace(/\/$/, "");
      const res = await fetch(`${base}/health`, { method: "GET" });
      if (res.ok) {
        setStatus("ok");
        setMessage(t("connected"));
      } else {
        setStatus("error");
        setMessage(`HTTP ${res.status}`);
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : t("connectionFailed"));
    }
  };

  const save = () => {
    const normalizedBase = url.trim().replace(/\/$/, "");
    setBackendUrl(normalizedBase);
    api.defaults.baseURL = normalizedBase;
    navigate("/login");
  };

  useEffect(() => {
    setUrl(getBackendUrl());
  }, []);

  return (
    <PreflightShell
      steps={steps}
      activeIndex={0}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <div className="flex flex-col gap-7">
        <div>
          <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>
            {t("serverUrl")}
          </div>
          <p className="mt-2 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>
            {t("serverUrlDesc")}
          </p>
        </div>
        <KioskInput
          mono
          type="url"
          placeholder={t("serverUrlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {status === "checking" && <p className="text-kiosk-text-3">{t("checking")}</p>}
        {status === "ok" && (
          <p className="flex items-center gap-2 font-semibold text-kiosk-ok">
            <span aria-hidden className="size-3 rounded-full bg-kiosk-ok" />
            {message}
          </p>
        )}
        {status === "error" && <p className="text-kiosk-danger-soft">{message}</p>}
        <div className="flex gap-4">
          <KioskButton variant="outline" onClick={checkConnection} disabled={status === "checking"}>
            {t("connect")}
          </KioskButton>
          <KioskButton onClick={save}>{t("saveAndGoToLoginShort")}</KioskButton>
        </div>
      </div>
    </PreflightShell>
  );
}
```

- [ ] **Step 4: Rewrite `desktop/src/pages/Login.tsx`**

Read the file first, then replace its contents:

```tsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { api } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      if (response.data.tenants) {
        localStorage.setItem("tenants", JSON.stringify(response.data.tenants));
      }
      if (response.data.current_tenant) {
        localStorage.setItem("current_tenant", JSON.stringify(response.data.current_tenant));
      }
      navigate("/checkin");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(msg || t("loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PreflightShell
      steps={steps}
      activeIndex={1}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-7">
        <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>
          {t("login")}
        </div>
        <div className="flex flex-col gap-4">
          <KioskInput
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <KioskInput
            type="password"
            placeholder={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-kiosk-danger-soft">{error}</p>}
        <KioskButton type="submit" disabled={loading}>
          {loading ? "…" : t("login")}
        </KioskButton>
        <div className="flex justify-center gap-6 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          <Link to="/qr-login" className="text-kiosk-brand hover:underline">
            {t("qrLogin")}
          </Link>
          <Link to="/connection" className="hover:text-kiosk-text">
            {t("serverUrl")}
          </Link>
        </div>
      </form>
    </PreflightShell>
  );
}
```

- [ ] **Step 5: Rewrite `desktop/src/pages/QRLogin.tsx`**

Read the file first, then replace its contents:

```tsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { api } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";

export default function QRLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [qrToken, setQrToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/auth/login-qr", { qr_token: qrToken.trim() });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      navigate("/checkin");
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

  return (
    <PreflightShell
      steps={steps}
      activeIndex={1}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-7">
        <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>
          {t("qrLogin")}
        </div>
        <KioskInput
          mono
          type="text"
          placeholder={t("enterQRToken")}
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
        />
        {error && <p className="text-kiosk-danger-soft">{error}</p>}
        <KioskButton type="submit" disabled={loading}>
          {loading ? "…" : t("qrLogin")}
        </KioskButton>
        <div className="flex justify-center gap-6 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          <Link to="/login" className="text-kiosk-brand hover:underline">
            {t("login")}
          </Link>
          <Link to="/connection" className="hover:text-kiosk-text">
            {t("serverUrl")}
          </Link>
        </div>
      </form>
    </PreflightShell>
  );
}
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck -w idento-desktop
npm run build -w idento-desktop
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/preflight/steps.ts desktop/src/pages/Connection.tsx desktop/src/pages/Login.tsx desktop/src/pages/QRLogin.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): pre-flight rail + restyle Connection/Login/QRLogin to kiosk-strict"
```

---

### Task 11: Equipment restyle + station registration

**Files:**
- Modify: `desktop/src/pages/Equipment.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: `PreflightShell`/`KioskButton`/`KioskInput` from `@idento/ui/kiosk`, `useRegisterStation`/`useCheckinStations` from `@/features/checkin/hooks`, `usePreflightSteps` from `@/features/preflight/steps`.
- Produces: after this task, a registered `station_id` is persisted to `localStorage` under the key `idento_station_id`, read by Task 14's run screen.

This task keeps every existing printer/scanner/test-scanner API call and state (`fetchEquipmentData`, `addNetworkPrinter`, `removeNetworkPrinter`, `setDefaultPrinterAction`, `addScanner`, `startScannerTest`/`endScannerTest`) unchanged, restyles the page onto `PreflightShell`, and adds one new card: station name + register button.

- [ ] **Step 1: Add translation keys**

In `desktop/src/i18n.ts`, add to `en.translation`:

```ts
        stationName: "Station name",
        stationNamePlaceholder: "e.g. Front Desk 1",
        stationRegister: "Register station",
        stationRegistered: "Station registered",
        stationRegisterFailed: "Failed to register station",
        continueButton: "Continue",
```

Add to `ru.translation`:

```ts
        stationName: "Имя станции",
        stationNamePlaceholder: "напр. Стойка 1",
        stationRegister: "Зарегистрировать станцию",
        stationRegistered: "Станция зарегистрирована",
        stationRegisterFailed: "Не удалось зарегистрировать станцию",
        continueButton: "Продолжить",
```

- [ ] **Step 2: Read `desktop/src/pages/Equipment.tsx` in full**, then apply these changes:

1. Add imports:

```ts
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { useParams } from "react-router-dom";
import { useRegisterStation } from "@/features/checkin/hooks";
import { usePreflightSteps } from "@/features/preflight/steps";
```

(Keep every existing import — `useState`/`useEffect`/`useCallback`/`useRef`, `useTranslation`, icons, `agent`/`api` libs, `checkinSettings` lib, `toast`, `LanguageSwitcher`.)

2. The route for this page becomes event-scoped: `/checkin/:eventId/equipment` (see Task 14's routing step). Read `eventId` via `useParams<{ eventId: string }>()` at the top of the component, alongside the existing state declarations.

3. Add station registration state, right after the existing `checkinSettings` state block:

```ts
  const [stationName, setStationName] = useState("");
  const [stationId, setStationId] = useState<string | null>(() => localStorage.getItem("idento_station_id"));
  const registerStation = useRegisterStation(eventId!);

  const registerStationAction = async () => {
    if (!stationName.trim()) return;
    try {
      const station = await registerStation.mutateAsync({ name: stationName.trim() });
      localStorage.setItem("idento_station_id", station.id);
      setStationId(station.id);
      toast.success(t("stationRegistered"));
    } catch {
      toast.error(t("stationRegisterFailed"));
    }
  };
```

4. Add `const steps = usePreflightSteps();` near the top of the component (alongside other hook calls).

5. Replace the outer return's wrapper: change the top-level `<div className="min-h-screen bg-background p-4">...header...</div>` structure to use `PreflightShell`. The full returned JSX becomes:

```tsx
  return (
    <PreflightShell
      steps={steps}
      activeIndex={2}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      {loading ? (
        <p className="text-kiosk-text-3">{t("loading")}</p>
      ) : !agentConnected ? (
        <div className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-8">
          <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.7)" }}>
            {t("agentNotConnected")}
          </div>
          <p className="mt-2 text-kiosk-text-3">{t("agentNotConnectedDesc")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Printers card -- unchanged content, restyled container */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="flex items-center gap-2 font-bold text-kiosk-text">
              <Printer className="size-5" />
              {t("printers")}
            </div>
            <p className="mt-1 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {t("printersCount", { count: printers.length })}
            </p>
            <ul className="mt-4 space-y-1" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {printers.length === 0 ? (
                <li className="text-kiosk-text-3">{t("noPrintersFound")}</li>
              ) : (
                printers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-kiosk-text-2">
                    <span className="flex items-center gap-2">
                      {p.name}
                      {p.type === "network" ? ` (${t("network")})` : ""}
                      {defaultPrinter === p.name && (
                        <span title={t("defaultPrinter")}>
                          <Star className="size-4 fill-kiosk-warn text-kiosk-warn" />
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      {defaultPrinter !== p.name && (
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-kiosk-text-3 hover:text-kiosk-text"
                          onClick={() => setDefaultPrinterAction(p.name)}
                        >
                          {t("setAsDefault")}
                        </button>
                      )}
                      {p.type === "network" && (
                        <button
                          type="button"
                          className="rounded p-1 text-kiosk-danger-soft hover:opacity-80"
                          onClick={() => removeNetworkPrinter(p.name)}
                          title={t("removePrinter")}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-4 grid gap-2 rounded-xl border border-kiosk-border-2 p-3 sm:grid-cols-4">
              <KioskInput placeholder={t("printerNamePlaceholder")} value={networkName} onChange={(e) => setNetworkName(e.target.value)} />
              <KioskInput placeholder={t("printerIpPlaceholder")} value={networkIP} onChange={(e) => setNetworkIP(e.target.value)} />
              <KioskInput placeholder={t("printerPortPlaceholder")} value={networkPort} onChange={(e) => setNetworkPort(e.target.value)} />
              <KioskButton size="md" onClick={addNetworkPrinter}>
                <PlusCircle className="mr-1 size-4" />
                {t("addNetworkPrinter")}
              </KioskButton>
            </div>
          </section>

          {/* Scanners card -- unchanged content, restyled container */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="flex items-center gap-2 font-bold text-kiosk-text">
              <ScanLine className="size-5" />
              {t("scanners")}
            </div>
            <p className="mt-1 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {t("scannersCount", { count: scanners.length })}
            </p>
            <ul className="mt-4 list-inside list-disc space-y-1 text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {scanners.length === 0 ? <li className="text-kiosk-text-3">{t("noScannersConfigured")}</li> : scanners.map((s) => <li key={s}>{s}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <KioskInput
                placeholder="COM3"
                value={scannerPort}
                onChange={(e) => setScannerPort(e.target.value)}
                list="scanner-ports"
              />
              {availablePorts.length > 0 && (
                <datalist id="scanner-ports">
                  {availablePorts.map((p) => (
                    <option key={p.port_name} value={p.port_name} />
                  ))}
                </datalist>
              )}
              <KioskButton size="md" onClick={addScanner}>
                <PlusCircle className="mr-1 size-4" />
                {t("addScanner")}
              </KioskButton>
            </div>
          </section>

          {/* NEW: station registration */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="font-bold text-kiosk-text">{t("stationName")}</div>
            {stationId ? (
              <p className="mt-3 flex items-center gap-2 text-kiosk-ok">
                <span aria-hidden className="size-3 rounded-full bg-kiosk-ok" />
                {t("stationRegistered")}
              </p>
            ) : (
              <div className="mt-3 flex gap-3">
                <KioskInput
                  placeholder={t("stationNamePlaceholder")}
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                />
                <KioskButton size="md" onClick={registerStationAction} disabled={!stationName.trim()}>
                  {t("stationRegister")}
                </KioskButton>
              </div>
            )}
          </section>

          {/* Scanner test card -- unchanged content, restyled container */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="font-bold text-kiosk-text">{t("testScanner")}</div>
            <p className="mt-1 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {t("testScannerDesc")}
            </p>
            <div className="mt-4">
              {testResult === "idle" && <KioskButton size="md" onClick={startScannerTest}>{t("startScannerTest")}</KioskButton>}
              {testResult === "waiting" && (
                <div className="flex flex-wrap items-start gap-4">
                  {testQRImage && (
                    <div>
                      <img src={testQRImage} alt="Test QR" className="rounded-xl border border-kiosk-border-2" width={200} height={200} />
                      <p className="mt-2 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{t("scanThisCode")}</p>
                    </div>
                  )}
                  <KioskButton size="md" variant="outline" onClick={endScannerTest}>{t("cancel")}</KioskButton>
                </div>
              )}
              {testResult === "success" && (
                <div className="flex items-center gap-2 text-kiosk-ok">
                  <CheckCircle className="size-5" />
                  <span>{t("scannerTestPassed")}</span>
                  <KioskButton size="md" variant="outline" onClick={endScannerTest}>{t("done")}</KioskButton>
                </div>
              )}
              {testResult === "timeout" && (
                <div className="flex items-center gap-2 text-kiosk-warn">
                  <span>{t("scannerTestTimedOut")}</span>
                  <KioskButton size="md" variant="outline" onClick={endScannerTest}>{t("done")}</KioskButton>
                </div>
              )}
            </div>
          </section>

          <KioskButton
            disabled={!stationId}
            onClick={() => navigate(`/checkin/${eventId}/mode`)}
          >
            {t("continueButton")}
          </KioskButton>
        </div>
      )}
    </PreflightShell>
  );
```

6. Remove the old header block (`<header className="mb-6 flex items-center justify-between border-b pb-4">...</header>`) and the old "check-in settings" `<Card>` (the mode/print-labels card) — that content moves to Task 12's new Mode & Settings step, and `checkinSettings`/`persistCheckinSettings` local state becomes unused here; delete `checkinSettings`/`persistCheckinSettings` and the `KioskCheckinSettings`/`loadCheckinSettings`/`saveCheckinSettings` import from `@/lib/checkinSettings` (that whole card's logic moves to Task 12).

- [ ] **Step 3: Verify**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
```

Expected: clean (fix any now-unused imports/variables flagged by `noUnusedLocals`).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/pages/Equipment.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): restyle Equipment to kiosk-strict, add station registration"
```

---

### Task 12: Mode & settings step

**Files:**
- Create: `desktop/src/pages/Mode.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: `useCheckinSettings`/`useSaveCheckinSettings` from `@/features/checkin/hooks`, `PreflightShell`/`KioskButton` from `@idento/ui/kiosk`, `usePreflightSteps`.
- Produces: the run-screen layout choice, persisted to `localStorage` under `idento_run_layout` (`"bar" | "panel"`), read by Task 14.

- [ ] **Step 1: Add translation keys**

In `desktop/src/i18n.ts`, add to `en.translation`:

```ts
        modeLayoutTitle: "Screen layout",
        modeLayoutBar: "Top status bar",
        modeLayoutPanel: "Operator panel",
        modeScanInputTitle: "Scan input",
        modeScanInputWedge: "Keyboard-wedge scanner",
        modeScanInputScanner: "Hardware scanner (via agent)",
        modeScanInputManual: "Manual search only",
        modePrintTitle: "Print on check-in",
        modeManualSearchTitle: "Manual search fallback",
        modeDismissTitle: "Verdict auto-dismiss (seconds)",
        modeSaveAndStart: "Save and start",
```

Add to `ru.translation`:

```ts
        modeLayoutTitle: "Компоновка экрана",
        modeLayoutBar: "Статус-полоса сверху",
        modeLayoutPanel: "Панель оператора",
        modeScanInputTitle: "Вход сканирования",
        modeScanInputWedge: "Клавиатурный сканер (wedge)",
        modeScanInputScanner: "Аппаратный сканер (через агент)",
        modeScanInputManual: "Только поиск вручную",
        modePrintTitle: "Печатать при отметке",
        modeManualSearchTitle: "Резервный поиск вручную",
        modeDismissTitle: "Автовозврат вердикта (секунды)",
        modeSaveAndStart: "Сохранить и начать",
```

- [ ] **Step 2: Create `desktop/src/pages/Mode.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PreflightShell, KioskButton } from "@idento/ui/kiosk";
import { useCheckinSettings, useSaveCheckinSettings } from "@/features/checkin/hooks";
import { usePreflightSteps } from "@/features/preflight/steps";
import { DEFAULT_CHECKIN_SETTINGS, type CheckinSettings } from "@/features/checkin/settingsTypes";

export type RunLayout = "bar" | "panel";

const RUN_LAYOUT_KEY = "idento_run_layout";

export function loadRunLayout(): RunLayout {
  return localStorage.getItem(RUN_LAYOUT_KEY) === "panel" ? "panel" : "bar";
}

export default function ModePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const steps = usePreflightSteps();
  const settingsQuery = useCheckinSettings(eventId!);
  const saveSettings = useSaveCheckinSettings(eventId!);

  const [layout, setLayout] = useState<RunLayout>(loadRunLayout);
  const [settings, setSettings] = useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);

  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);

  const saveAndStart = async () => {
    try {
      await saveSettings.mutateAsync(settings);
      localStorage.setItem(RUN_LAYOUT_KEY, layout);
      navigate(`/checkin/${eventId}`);
    } catch {
      toast.error(t("checkinFailed"));
    }
  };

  const optionButtonClass = (active: boolean) =>
    active ? "border-kiosk-brand bg-kiosk-brand/10 text-kiosk-text" : "border-kiosk-border-2 text-kiosk-text-3";

  return (
    <PreflightShell steps={steps} activeIndex={4}>
      {settingsQuery.isLoading ? (
        <p className="text-kiosk-text-3">{t("loading")}</p>
      ) : (
        <div className="flex flex-col gap-7">
          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeLayoutTitle")}</div>
            <div className="mt-3 flex gap-3">
              {(["bar", "panel"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
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
                <button
                  key={value}
                  type="button"
                  className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(settings.scan_input === value)}`}
                  onClick={() => setSettings((prev) => ({ ...prev, scan_input: value }))}
                >
                  {value === "wedge" ? t("modeScanInputWedge") : value === "scanner" ? t("modeScanInputScanner") : t("modeScanInputManual")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-kiosk-text">{t("modePrintTitle")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.print_on_checkin}
              className={`h-8 w-14 rounded-full transition-colors ${settings.print_on_checkin ? "bg-kiosk-brand" : "bg-kiosk-border-2"}`}
              onClick={() => setSettings((prev) => ({ ...prev, print_on_checkin: !prev.print_on_checkin }))}
            >
              <span className={`block size-6 rounded-full bg-kiosk-text transition-transform ${settings.print_on_checkin ? "translate-x-7" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-kiosk-text">{t("modeManualSearchTitle")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.manual_search_enabled}
              className={`h-8 w-14 rounded-full transition-colors ${settings.manual_search_enabled ? "bg-kiosk-brand" : "bg-kiosk-border-2"}`}
              onClick={() => setSettings((prev) => ({ ...prev, manual_search_enabled: !prev.manual_search_enabled }))}
            >
              <span className={`block size-6 rounded-full bg-kiosk-text transition-transform ${settings.manual_search_enabled ? "translate-x-7" : "translate-x-1"}`} />
            </button>
          </div>

          <div>
            <span className="text-kiosk-text">
              {t("modeDismissTitle")}: {settings.verdict_auto_dismiss_sec}
            </span>
            <input
              type="range"
              min={1}
              max={30}
              value={settings.verdict_auto_dismiss_sec}
              onChange={(e) => setSettings((prev) => ({ ...prev, verdict_auto_dismiss_sec: Number(e.target.value) }))}
              className="mt-2 w-full"
            />
          </div>

          <KioskButton onClick={saveAndStart} disabled={saveSettings.isPending}>
            {t("modeSaveAndStart")}
          </KioskButton>
        </div>
      )}
    </PreflightShell>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/pages/Mode.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): mode & check-in settings pre-flight step"
```

---

### Task 13: Event selection restyle

**Files:**
- Modify: `desktop/src/pages/Checkin.tsx`

**Interfaces:**
- Consumes: `PreflightShell` from `@idento/ui/kiosk`, `usePreflightSteps`.
- Produces: nothing new — clicking an event now navigates to `/checkin/:eventId/equipment` (pre-flight continues) instead of directly into a run screen.

- [ ] **Step 1: Read `desktop/src/pages/Checkin.tsx` in full**, then replace its contents:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell } from "@idento/ui/kiosk";
import { api, clearSession } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";
import { toast } from "sonner";

type Event = { id: string; name: string };

export default function CheckinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    setFetchError(false);
    api
      .get<Event[]>("/api/events")
      .then((res: { data: Event[] }) => setEvents(Array.isArray(res.data) ? res.data : []))
      .catch(() => {
        setFetchError(true);
        setEvents([]);
        toast.error(t("eventsFetchFailed"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <PreflightShell
      steps={steps}
      activeIndex={3}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
          <button type="button" className="text-kiosk-text-3 hover:text-kiosk-text" onClick={() => { clearSession(); navigate("/login"); }}>
            {t("logout")}
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="text-kiosk-text-3">{t("loadingEvents")}</p>
      ) : fetchError ? (
        <p className="text-kiosk-danger-soft">{t("eventsFetchFailedDesc")}</p>
      ) : events.length === 0 ? (
        <p className="text-kiosk-text-3">{t("noEventsDesc")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {events.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className="h-[320px] w-[500px] rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6 text-left hover:border-kiosk-brand"
              onClick={() => navigate(`/checkin/${ev.id}/equipment`)}
            >
              <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{ev.name}</div>
            </button>
          ))}
        </div>
      )}
    </PreflightShell>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/pages/Checkin.tsx
git commit -m "feat(desktop): restyle event selection to kiosk-strict"
```

---

### Task 14: Run screen (1a/1c) + routing wiring

**Files:**
- Create: `desktop/src/pages/Run.tsx`
- Modify: `desktop/src/App.tsx`
- Delete: `desktop/src/pages/CheckinEvent.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–13 (`useCheckinFlow`, `useScanInput`, `useHeartbeat`, `useConnectionState`, `useAgentDefaultPrinter`, `useAgentHealth`, `useCheckinSettings`, `useCheckinActions`, `useEvent`, `loadRunLayout`, and `TopStatusBar`/`OperatorPanel`/`VerdictScreen`/`BlockingBanner`/`RecentLog`/`KioskInput`/`BarcodeBeam`/`stationLevel`/`KioskNode` from `@idento/ui/kiosk`).
- Produces: the route `/checkin/:eventId` renders the staffed run screen.

- [ ] **Step 1: Add translation keys**

In `desktop/src/i18n.ts`, add to `en.translation`:

```ts
        runReadyToScan: "Ready to scan",
        runScanHint: "Scan the ticket QR code with the scanner or camera",
        runManualSearchPlaceholder: "Search by name, email, or code…",
        runNoServer: "No connection to the server",
        runNoServerDesc: "Check-ins are not being recorded",
        runRetryNow: "Retry now",
        runPrinterWaiting: "Waiting for a printer…",
        runNodeServer: "Server",
        runNodeAgent: "Agent",
        runNodePrinter: "Printer",
        runNodeScanner: "Scanner",
        runCounted: "Checked in",
        runAlreadyHighlight: "Already checked in",
        runNotFoundTitle: "CODE NOT FOUND",
        runNotFoundMessage: "This code is not on the event's list",
        runBlockedTitle: "ACCESS DENIED",
        runAllowedTitle: "CHECKED IN",
        runAlreadyTitle: "ALREADY CHECKED IN",
```

Add to `ru.translation`:

```ts
        runReadyToScan: "Готов к сканированию",
        runScanHint: "Поднесите QR-код билета к сканеру или камере",
        runManualSearchPlaceholder: "Поиск по имени, email или коду…",
        runNoServer: "Нет связи с сервером",
        runNoServerDesc: "Отметки не записываются",
        runRetryNow: "Повторить сейчас",
        runPrinterWaiting: "Ожидание принтера…",
        runNodeServer: "Сервер",
        runNodeAgent: "Агент",
        runNodePrinter: "Принтер",
        runNodeScanner: "Сканер",
        runCounted: "Отмечено",
        runAlreadyHighlight: "Уже отмечен",
        runNotFoundTitle: "КОД НЕ НАЙДЕН",
        runNotFoundMessage: "Этого кода нет в списке события",
        runBlockedTitle: "ПРОПУСК АННУЛИРОВАН",
        runAllowedTitle: "ОТМЕЧЕНА",
        runAlreadyTitle: "УЖЕ ОТМЕЧЕН",
```

- [ ] **Step 2: Create `desktop/src/pages/Run.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  TopStatusBar,
  OperatorPanel,
  VerdictScreen,
  BlockingBanner,
  RecentLog,
  KioskInput,
  BarcodeBeam,
  stationLevel,
  type KioskNode,
} from "@idento/ui/kiosk";
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinActions,
  useCheckinSettings,
  useEvent,
} from "@/features/checkin/hooks";
import { useCheckinFlow } from "@/features/checkin/useCheckinFlow";
import { useConnectionState } from "@/features/checkin/useConnectionState";
import { useHeartbeat } from "@/features/checkin/useHeartbeat";
import { useScanInput } from "@/features/checkin/useScanInput";
import { DEFAULT_CHECKIN_SETTINGS } from "@/features/checkin/settingsTypes";
import { loadRunLayout } from "@/pages/Mode";

export default function RunPage() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const stationId = localStorage.getItem("idento_station_id");
  const layout = loadRunLayout();

  useHeartbeat(eventId!, stationId);
  const connection = useConnectionState(eventId!);
  const eventQuery = useEvent(eventId!);
  const settingsQuery = useCheckinSettings(eventId!);
  const settings = settingsQuery.data ?? DEFAULT_CHECKIN_SETTINGS;
  const printer = useAgentDefaultPrinter();
  const agentHealth = useAgentHealth();
  const actionsQuery = useCheckinActions(eventId!);

  const printerGateActive = settings.print_on_checkin && !printer.data;

  const flow = useCheckinFlow({
    eventId: eventId!,
    stationId,
    settings,
    printerName: printer.data ?? "",
  });

  const [searchValue, setSearchValue] = useState("");
  const scanEnabled = flow.state.status === "idle" && connection.online && !printerGateActive;

  const { wedgeInputProps, degraded: scannerDegraded } = useScanInput({
    mode: settings.scan_input,
    onCode: (code) => void flow.submitCode(code).catch(() => {}),
    enabled: scanEnabled,
  });

  const nodes: KioskNode[] = useMemo(
    () => [
      { id: "server", label: t("runNodeServer"), level: connection.online ? "ok" : "error" },
      { id: "agent", label: t("runNodeAgent"), level: agentHealth.data ? "ok" : "error" },
      {
        id: "printer",
        label: t("runNodePrinter"),
        level: !settings.print_on_checkin ? "ok" : printer.data ? "ok" : "warn",
        detail: printer.data ?? undefined,
      },
      {
        id: "scanner",
        label: t("runNodeScanner"),
        level: settings.scan_input === "scanner" && scannerDegraded ? "error" : "ok",
        live: settings.scan_input === "scanner",
      },
    ],
    [t, connection.online, agentHealth.data, settings.print_on_checkin, settings.scan_input, printer.data, scannerDegraded],
  );

  const level = stationLevel(nodes);

  const log = (actionsQuery.data ?? [])
    .filter((row) => row.action === "checkin")
    .slice(0, 3)
    .map((row) => ({
      time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      name: `${row.attendee.first_name} ${row.attendee.last_name}`,
      outcome: "allowed" as const,
    }));

  const verdictProps = (() => {
    if (flow.state.status !== "verdict" || !flow.state.verdict) return null;
    const v = flow.state.verdict;
    const name = flow.state.attendee ? `${flow.state.attendee.first_name} ${flow.state.attendee.last_name}` : undefined;
    if (v === "allowed") {
      return {
        verdict: v,
        title: t("runAllowedTitle"),
        name,
        actions: settings.print_on_checkin
          ? undefined
          : [{ label: t("print"), kind: "solid" as const, onClick: () => void flow.printCurrent() }],
        autoReturn: { label: t("checking"), progress: 0.5 },
      };
    }
    if (v === "already_checked_in") {
      return {
        verdict: v,
        title: t("runAlreadyTitle"),
        name,
        highlight: flow.state.checkin ? `${flow.state.checkin.at} · ${flow.state.checkin.by_email}` : undefined,
        actions: [{ label: t("done"), kind: "outline" as const, onClick: () => flow.clear() }],
      };
    }
    if (v === "no_access") {
      return {
        verdict: v,
        title: t("runBlockedTitle"),
        name,
        meta: flow.state.attendee?.block_reason ? [{ label: t("stationRegisterFailed"), value: flow.state.attendee.block_reason }] : undefined,
        actions: [{ label: t("done"), kind: "outline" as const, onClick: () => flow.clear() }],
      };
    }
    return {
      verdict: v,
      title: t("runNotFoundTitle"),
      message: t("runNotFoundMessage"),
      actions: [{ label: t("done"), kind: "outline" as const, onClick: () => flow.clear() }],
    };
  })();

  const eventName = eventQuery.data?.name ?? "";

  const chrome =
    layout === "panel" ? (
      <OperatorPanel eventName={eventName} nodes={nodes} counterValue={log.length} counterLabel={t("runCounted")} log={log} />
    ) : (
      <TopStatusBar eventName={eventName} nodes={nodes} counterLabel={t("runCounted")} counterValue={log.length} />
    );

  return (
    <div className="flex h-screen flex-col bg-kiosk-bg" style={{ fontFamily: "var(--kiosk-font)" }}>
      {layout === "bar" && chrome}
      {level === "blocked" && !connection.online && (
        <BlockingBanner title={t("runNoServer")} subtitle={t("runNoServerDesc")} retryLabel={t("runRetryNow")} onRetry={() => void actionsQuery.refetch()} />
      )}
      <div className="flex flex-1 overflow-hidden">
        {layout === "panel" && chrome}
        <div className="flex flex-1 flex-col items-center justify-center gap-10 p-10">
          {verdictProps ? (
            <VerdictScreen {...verdictProps} className="h-full w-full" />
          ) : printerGateActive ? (
            <p className="text-kiosk-text-3">{t("runPrinterWaiting")}</p>
          ) : (
            <>
              {settings.scan_input !== "manual" && <BarcodeBeam dimmed={!scanEnabled} />}
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="kiosk-type-idle-title text-kiosk-text">{t("runReadyToScan")}</div>
                <p className="text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>{t("runScanHint")}</p>
              </div>
              <input aria-hidden {...wedgeInputProps} className="sr-only" />
              {settings.manual_search_enabled && (
                <KioskInput
                  className="w-[480px]"
                  placeholder={t("runManualSearchPlaceholder")}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  disabled={!scanEnabled}
                />
              )}
            </>
          )}
        </div>
      </div>
      {layout === "bar" && log.length > 0 && <RecentLog entries={log} />}
    </div>
  );
}
```

- [ ] **Step 3: Update `desktop/src/App.tsx`**

Read the file first, then replace its contents:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import LoginPage from "./pages/Login";
import QRLoginPage from "./pages/QRLogin";
import ConnectionPage from "./pages/Connection";
import EquipmentPage from "./pages/Equipment";
import CheckinPage from "./pages/Checkin";
import ModePage from "./pages/Mode";
import RunPage from "./pages/Run";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/qr-login" element={<QRLoginPage />} />
        <Route path="/connection" element={<ConnectionPage />} />
        <Route
          path="/checkin"
          element={
            <ProtectedRoute>
              <CheckinPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/equipment"
          element={
            <ProtectedRoute>
              <EquipmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/mode"
          element={
            <ProtectedRoute>
              <ModePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId"
          element={
            <ProtectedRoute>
              <RunPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

Note: `/equipment` (the old standalone route) is removed — equipment is now event-scoped (`/checkin/:eventId/equipment`), reached only via the pre-flight event-selection step (Task 13). This matches the design: station registration needs an `event_id`.

- [ ] **Step 4: Delete `desktop/src/pages/CheckinEvent.tsx`**

```bash
git rm desktop/src/pages/CheckinEvent.tsx
```

Its logic (client-side attendee-list lookup + `PUT /api/attendees/:id`, jsQR camera scanning, markdown badge templates) is fully superseded by `Run.tsx` + the Task 2–9 hooks. Camera scanning is explicitly deferred (Global Constraints) — if any later task restores it, it will be as a `scanner`-mode input source (per the approved spec), not a revival of this file.

- [ ] **Step 5: Verify**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: clean. Fix any leftover references to the deleted `CheckinEvent.tsx`, `desktop/src/lib/markdownTemplate.ts`, or `desktop/src/lib/checkinSettings.ts` (both now unused — if `npm run lint`/`tsc` don't flag them as unused exports, leave them; if any import error surfaces, remove the dangling import).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/pages/Run.tsx desktop/src/App.tsx desktop/src/i18n.ts
git rm desktop/src/pages/CheckinEvent.tsx
git commit -m "feat(desktop): staffed run screen (1a/1c) wired to the check-in loop, routing wiring"
```

---

## Out of scope for K2a (later plans)

- K2b: self-service lockdown, attract screen, staff-QR exit.
- Camera as a scan input source.
- Offline write queue.
- Undo/Reprint from the kiosk itself.
- Light theme.
- Splitting `desktop`'s CI job (PR-time typecheck/test/`vite build` vs. release-time Tauri bundle) — flagged by K1's final review, not yet acted on.
