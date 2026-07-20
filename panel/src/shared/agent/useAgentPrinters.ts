import { useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { agentClient, type AgentPrinter } from "./agentClient";
import { useAgentInfo } from "./useAgentInfo";
import { useEquipmentMachine } from "./useEquipmentMachine";

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
  // Renamed from `configuredDefault` (P4.3 Task 10): this is now only the
  // AGENT's own opinion (verbatim GET /printers/default), one input to the
  // precedence chain below rather than the whole story.
  const agentConfiguredDefault = query.data?.configuredDefault ?? null;

  // P4.3 Task 10 (spec decision 2): the equipment registry's own default
  // printer (set explicitly via the hub, spec §4.1) outranks the agent's
  // own configured default -- an operator who picked a default in the hub
  // shouldn't be silently overridden by whatever the OS/driver-level agent
  // reports as ITS default. `useAgentInfo` runs its own health-gated probe
  // (same as `fetchAgentPrinters` above) purely to resolve this machine's
  // identity -- yes, that's a SECOND GET /health per cycle, but it's cheap,
  // same-origin, and any other useAgentInfo consumer mounted on this page
  // shares its query key via TanStack's cache, so this stays additive
  // rather than a restructuring of this hook's own probe (whose
  // isError/isSuccess semantics below are load-bearing and are left alone).
  //
  // Gated on `enabled` alone -- deliberately NOT also on the printers list
  // having resolved (task 10 review): the identity -> registry chain starts
  // concurrently with this hook's own probe at mount, so the registry
  // default lands as early as possible instead of serializing behind
  // printers and widening the window where `configuredDefault` still
  // reflects only the agent's own default (AttendeeDrawer/BulkBar read it
  // live, every render, for their ask-vs-don't-ask decision). Tests that
  // render any consumer of this hook get harness-level 404 defaults for
  // GET /info and the machines endpoint (test/msw.ts) -- the legacy-agent /
  // empty-registry baseline under which this whole block is inert.
  const { info } = useAgentInfo(enabled);
  const machineId = enabled ? (info?.machine_id ?? null) : null;
  const machine = useEquipmentMachine(machineId);

  // PR #83 bot-review round 1, Finding 8: for a MODERN agent (machineId
  // known), the registry query is genuinely enabled and racing the printers
  // probe -- while it's still PENDING (`isPending`: not yet success OR
  // error; a query stuck disabled, i.e. `machineId === null`, is EXCLUDED
  // by the `machineId != null` half of this check, since that's the
  // legacy/no-identity path, which must keep resolving the agent default
  // immediately, same as before this task), falling through to the agent's
  // OWN configured default below would be a GUESS: the registry read
  // moments later might override it with a different (or no) server
  // default, and a print fired during that window could go to the wrong
  // printer. `registryPending` forces `configuredDefault` to null during
  // that window -- the safe direction (a caller then asks, per this hook's
  // own field-semantics contract, rather than silently printing).
  const registryPending = machineId != null && machine.isPending;

  const registryDefaultAgentName = (() => {
    const devices = machine.data?.devices ?? [];
    const def = devices.find((d) => d.is_default && d.class === "printer");
    const agentName = (def?.config as { agent_name?: string } | undefined)?.agent_name;
    // Same live-list presence rule the agent's own configured default
    // already obeys just below (the web-parity comment) -- a registry
    // default is only honored while the agent can currently SEE a printer
    // by that name; a registry default pointing at a since-unplugged
    // printer falls through to the agent default exactly as if no registry
    // default were set (never onto a name absent from `printers`).
    return agentName && printers.some((printer) => printer.name === agentName) ? agentName : null;
  })();

  // server (registry) > agent config > null -- P4.3 spec decision 2. Field
  // name/semantics returned below are UNCHANGED for every P3.2 consumer
  // (TestPrintDialog, drawer reprint, bulk print, station): still null iff
  // neither the registry nor the agent has a default, never silently
  // inheriting `defaultPrinter`'s own "first in list" convenience fallback.
  // Finding 8: `registryPending` short-circuits straight to null, ahead of
  // both the registry AND the agent-config fallback -- see that comment
  // above.
  const configuredDefault = registryPending ? null : (registryDefaultAgentName ?? agentConfiguredDefault);

  // Web parity rule (web/src/pages/EquipmentSettings.tsx's fetchPrinters):
  // the (now server-first) configured default printer only wins if it's
  // still present in the CURRENT printer list — it may have been
  // unplugged/removed since it was configured. Otherwise fall back to the
  // first printer so the selector always has a valid preselection whenever
  // any printer exists.
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
