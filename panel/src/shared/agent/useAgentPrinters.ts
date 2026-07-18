import { useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { agentClient, type AgentPrinter } from "./agentClient";

// One connectivity state shared by every print surface (test-print dialog,
// drawer reprint, bulk print — see docs/superpowers/plans/
// 2026-07-16-panel-p3.2-print-truth.md, Task 3). "checking" maps onto
// @idento/ui's AgentStatus "stale" state where rendered (that mapping is
// the consuming component's job, not this hook's).
export type AgentConnectivityState = "connected" | "disconnected" | "checking";

export interface UseAgentPrintersResult {
  state: AgentConnectivityState;
  printers: AgentPrinter[];
  defaultPrinter: string | null;
  // P3.2 Task 8: the agent's own CONFIGURED default (verbatim from
  // GET /printers/default), independent of `defaultPrinter`'s "always have
  // SOME preselection" fallback rule above -- null both while
  // disconnected/loading AND when the agent has printers but genuinely no
  // default configured. TestPrintDialog doesn't need this (its printer
  // <select> is always shown regardless, so `defaultPrinter`'s convenience
  // fallback is exactly what it wants); the drawer's Reprint confirm uses
  // this instead to decide whether the operator needs to be ASKED at all —
  // showing its own inline <select> only when this is null, never silently
  // picking "first in the list" on the operator's behalf.
  configuredDefault: string | null;
  // PR #77 bot-review round 3, Finding 3 -- exposed so a caller gating a UI
  // surface on this hook's own connectivity/printer state (StationPage.tsx's
  // printer-readiness gate) can re-probe on its own schedule while that gate
  // is active, WITHOUT this hook itself having an opinion on when that
  // should happen (every other consumer -- LaunchCeremony.tsx,
  // AttendeeDrawer.tsx, BulkBar.tsx, RecentScansRail.tsx, TestPrintDialog.tsx
  // -- already gets a fresh probe for free via `refetchOnWindowFocus`, so
  // this stays additive/opt-in rather than changing this hook's own default
  // polling behavior for everyone).
  refetch: () => Promise<QueryObserverResult<AgentPrintersData>>;
}

export const AGENT_PRINTERS_KEY = ["agent", "printers"] as const;

interface AgentPrintersData {
  printers: AgentPrinter[];
  configuredDefault: string | null;
}

async function fetchAgentPrinters(): Promise<AgentPrintersData> {
  const healthy = await agentClient.checkHealth();
  if (!healthy) {
    // Health-gated: no point listing printers once the agent has already
    // failed its health check — surfaces as query.isError, which the hook
    // below maps to state "disconnected".
    throw new Error("agent unreachable");
  }
  // PR #74 review round Fix 7: GET /printers and GET /printers/default used
  // to be `Promise.all`'d together, so the DEFAULT lookup failing (agent
  // implements /printers but errors on /printers/default) rejected this
  // WHOLE query — reporting the agent as fully disconnected even though the
  // printer list itself loaded fine and printing via an explicit choice is
  // still perfectly usable. `Promise.allSettled` keeps both requests
  // concurrent (no latency regression) while letting them fail
  // independently: the printer list is essential (its rejection still
  // fails this function, surfacing as "disconnected" same as before) but
  // the configured default is a convenience on top of it, so its failure
  // degrades to `configuredDefault: null` — the exact same shape as
  // "genuinely no default configured" — rather than taking connectivity
  // down with it.
  const [printersResult, configuredDefaultResult] = await Promise.allSettled([
    agentClient.getPrinters(),
    agentClient.getDefaultPrinter(),
  ]);
  if (printersResult.status === "rejected") throw printersResult.reason;
  const configuredDefault = configuredDefaultResult.status === "fulfilled" ? configuredDefaultResult.value : null;
  return { printers: printersResult.value, configuredDefault };
}

/**
 * TanStack Query against the agent origin (not `$api` — see agentClient.ts).
 * `enabled` gates the whole probe (health + printers + default) so a closed
 * dialog doesn't poll a possibly-absent local agent; `refetchOnWindowFocus`
 * is set explicitly (even though it's react-query's default) to document
 * the reconnect UX intent: tabbing back after plugging the agent back in
 * should re-probe without the caller doing anything.
 */
export function useAgentPrinters(enabled: boolean): UseAgentPrintersResult {
  const query = useQuery({
    queryKey: AGENT_PRINTERS_KEY,
    queryFn: fetchAgentPrinters,
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const printers = query.data?.printers ?? [];
  const configuredDefault = query.data?.configuredDefault ?? null;

  // Web parity rule (web/src/pages/EquipmentSettings.tsx's fetchPrinters):
  // the agent's configured default printer only wins if it's still present
  // in the CURRENT printer list — it may have been unplugged/removed since
  // it was configured. Otherwise fall back to the first printer so the
  // selector always has a valid preselection whenever any printer exists.
  const defaultPrinter =
    printers.length === 0
      ? null
      : configuredDefault && printers.some((printer) => printer.name === configuredDefault)
        ? configuredDefault
        : printers[0].name;

  let state: AgentConnectivityState;
  if (!enabled) {
    state = "disconnected";
  } else if (query.isSuccess) {
    state = "connected";
  } else if (query.isError) {
    state = "disconnected";
  } else {
    state = "checking";
  }

  return { state, printers, defaultPrinter, configuredDefault, refetch: query.refetch };
}
