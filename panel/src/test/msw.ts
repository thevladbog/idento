import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { RequestHandler } from "msw";
// Explicit import rather than relying on vitest's ambient globals: this file
// lives in src/test/ but isn't named *.test.ts, so tsconfig.app.json's
// test-file exclusion doesn't cover it — `npm run typecheck` (tsc -b) type-
// checks it against the app config, which has no vitest/globals types.
import { afterAll, afterEach, beforeAll } from "vitest";

// P4.3 Task 10 (review round): useAgentPrinters now internally runs
// useAgentInfo (agent GET /info) + useEquipmentMachine (backend GET
// /api/equipment/machines/{machine_id}) on every enabled mount, so EVERY
// suite that renders a print surface (StationPage, AttendeeDrawer, BulkBar,
// LaunchCeremony, RecentScansRail, TestPrintDialog) now hits these two
// endpoints without knowing it. Under `onUnhandledRequest: "error"` an
// unmocked GET /info doesn't just log — the request REJECTS, putting
// useAgentInfo's query into a genuine error state, which starts its
// error-only 8s `refetchInterval` retry loop (useAgentInfo.ts) inside
// suites that never asked for it (and collides with fake-timer tests'
// hand-tuned advance budgets, e.g. StationPage's 10s printer-gate poll
// test).
//
// These defaults are appended AFTER each suite's own handlers in
// startMswServer below — MSW matches first-registered-first, so any suite
// that mocks either endpoint itself (EquipmentPage.test.tsx,
// useAgentInfo.test.tsx, useAgentPrinters.test.tsx, equipment
// hooks.test.tsx) still wins, as does any per-test `server.use()` override
// (which prepends). For everyone else they pin the exact pre-P4.3
// baseline:
// - GET /info → 404 is the "legacy agent" contract (agentClient.getInfo
//   returns null instead of throwing; useAgentInfo resolves
//   connected_legacy — a SUCCESS state, so the error-only 8s retry loop
//   never starts and writeCachedAgentInfo is never called, since it only
//   fires on a non-null info). machine_id stays unknown, so
//   useEquipmentMachine stays disabled and the registry-default precedence
//   is inert — byte-identical legacy behavior for every consumer suite.
// - GET machines → 404 is the matching "empty registry" baseline for any
//   suite that DOES mock a real /info but not the registry.
const equipmentRegistryDefaults: RequestHandler[] = [
  http.get("http://agent.test/info", () => new HttpResponse(null, { status: 404 })),
  http.get("http://api.test/api/equipment/machines/:machineId", () => new HttpResponse(null, { status: 404 })),
];

// Opt-in MSW server for new tests. Call at the top of a describe file:
//   const server = startMswServer(...handlers)
// Handlers use absolute URLs against http://api.test (matching the
// window.__ENV__.API_URL the panel tests set in beforeEach).
export function startMswServer(...handlers: RequestHandler[]) {
  const server = setupServer(...handlers, ...equipmentRegistryDefaults);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
