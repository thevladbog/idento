import { useQuery } from "@tanstack/react-query";
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
  const [printers, configuredDefault] = await Promise.all([
    agentClient.getPrinters(),
    agentClient.getDefaultPrinter(),
  ]);
  return { printers, configuredDefault };
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

  return { state, printers, defaultPrinter };
}
