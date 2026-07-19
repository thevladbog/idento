import { useQuery } from "@tanstack/react-query";
import { agentClient, type AgentInfo } from "./agentClient";
import { readCachedAgentInfo, writeCachedAgentInfo } from "./agentInfoCache";

// Board 5a/5d's agent connectivity states for the equipment hub --
// distinct from useAgentPrinters.ts's AgentConnectivityState because this
// hook has a THIRD healthy-but-degraded state that hook doesn't need:
// "connected_legacy" is a reachable agent whose GET /info 404s (a
// pre-P4.3 binary, per agentClient.getInfo's contract) -- the agent works
// fine for printing/scanning, it just can't report machine identity yet.
export type AgentInfoState = "connected" | "connected_legacy" | "disconnected" | "checking";

export interface UseAgentInfoResult {
  state: AgentInfoState;
  /** Live GET /info result for the current probe. Null unless `state === "connected"`. */
  info: AgentInfo | null;
  /**
   * The last-known identity for this agent, read straight from
   * agentInfoCache on every render -- survives `state` going to
   * "disconnected" (board 5d: saved devices/identity must stay visible
   * while the agent is down) or "connected_legacy" (an old agent can't
   * refresh it, but a PRIOR connection on the same machine may already
   * have written one).
   */
  cachedInfo: AgentInfo | null;
  refetch: () => Promise<unknown>;
}

export const AGENT_INFO_KEY = ["agent", "info"] as const;

/**
 * Health-gated like useAgentPrinters' fetchAgentPrinters: no point calling
 * GET /info once GET /health has already failed. On a genuine identity
 * result (not the legacy-404 null) this also updates agentInfoCache, so the
 * NEXT disconnect on this machine has a fresh cached identity to fall back
 * to rather than whatever was last saved sessions ago.
 */
async function fetchAgentInfo(): Promise<AgentInfo | null> {
  const healthy = await agentClient.checkHealth();
  if (!healthy) {
    throw new Error("agent unreachable");
  }
  const info = await agentClient.getInfo();
  if (info) {
    writeCachedAgentInfo(info);
  }
  return info;
}

/**
 * TanStack Query against the agent origin (not `$api` -- see
 * agentClient.ts). `enabled` gates the whole probe the same way
 * useAgentPrinters does; `refetchOnWindowFocus` documents the same
 * reconnect-on-tab-refocus intent.
 *
 * `refetchInterval` is the board 5d "auto-retry in 8 s" behavior: while the
 * query is in its error state (agent unreachable) it re-probes every 8s on
 * its own, no user action required; once a probe succeeds (even
 * connected_legacy) the interval turns itself off again, since
 * `refetchOnWindowFocus` (plus any caller-triggered `refetch`) is enough to
 * catch a LATER disconnect.
 */
export function useAgentInfo(enabled: boolean): UseAgentInfoResult {
  const query = useQuery({
    queryKey: AGENT_INFO_KEY,
    queryFn: fetchAgentInfo,
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (activeQuery) => (activeQuery.state.status === "error" ? 8_000 : false),
  });

  let state: AgentInfoState;
  if (!enabled) {
    state = "disconnected";
  } else if (query.isSuccess) {
    state = query.data ? "connected" : "connected_legacy";
  } else if (query.isError) {
    state = "disconnected";
  } else {
    state = "checking";
  }

  return {
    state,
    // Gated on `isSuccess`, NOT a bare `query.data ?? null`: TanStack Query
    // keeps the last successful fetch's `data` around across a later FAILED
    // refetch (it only clears `data` on an explicit query-key change), so a
    // machine that goes from connected -> disconnected would otherwise keep
    // reporting stale live `info` even though `state` correctly flips to
    // "disconnected". `cachedInfo` above is the deliberate, explicit
    // mechanism for surfacing a last-known value across a disconnect --
    // `info` must reflect only the CURRENT probe.
    info: query.isSuccess ? (query.data ?? null) : null,
    // Plain read per render rather than mirrored into query/component state:
    // agentInfoCache is a synchronous localStorage read, so there's no
    // async gap to paper over, and a hub remount after a reconnect (or a
    // write from a DIFFERENT useAgentInfo consumer on the same page) picks
    // up the latest value for free without this hook needing to subscribe
    // to storage events or invalidate anything itself.
    cachedInfo: readCachedAgentInfo(),
    refetch: query.refetch,
  };
}
