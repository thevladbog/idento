// Restarts the embedded agent sidecar after sustained health-check
// failures. Rides on the SAME health signal that drives the "agent" status
// chip (useAgentHealth, K2a) instead of polling independently -- one source
// of truth for "is the agent up". A run of FAILURE_THRESHOLD consecutive
// misses triggers the first restart attempt immediately; if the agent is
// still unhealthy afterwards, further attempts are spaced by an
// exponential backoff (1s -> 2s -> 4s ... capped at 30s). The failure count
// and backoff both reset to their initial values on the first healthy
// check. Inactive outside "embedded" mode -- the desktop app doesn't own a
// standalone agent's process lifecycle, only its reachability.
//
// The evaluation logic below runs off the query CACHE's own subscription
// (queryClient.getQueryCache().subscribe), not a useEffect keyed on
// useAgentHealth()'s returned data/isLoading/dataUpdatedAt. TanStack Query
// defers the React-facing re-render for a query update by one macrotask
// (notifyManager batches the observer's React listener through a 0ms
// setTimeout so multiple state changes in one tick coalesce into a single
// render), which is invisible in the running app but means a naive
// useEffect dependency on the hook's return value reacts one poll late
// under fake timers (each refetch below lands exactly on a
// vi.advanceTimersByTimeAsync boundary, and that deferred hop needs its
// own follow-up tick to flush). The cache's own listeners, in contrast,
// run synchronously as part of the same dispatch that already updated the
// query's cached result, so reading queryClient.getQueryState here always
// sees the current settled value -- same source of truth, no render lag.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAgentMode } from "../../lib/agentConfig";
import { useAgentHealth } from "./hooks";

const FAILURE_THRESHOLD = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEALTH_QUERY_KEY = ["agent", "health"] as const;

async function restartAgentProcess(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("restart_agent");
}

export function useAgentSupervisor(): void {
  // Mounts/keeps alive the ["agent","health"] query (fetch on mount,
  // refetch every 20s) -- the same query the status chip reads. This hook
  // does not otherwise use the returned object; see the module doc above
  // for why the decision logic below reads the cache directly instead.
  useAgentHealth();
  const queryClient = useQueryClient();

  const failureCountRef = useRef(0);
  const recoveringRef = useRef(false);
  const cooldownActiveRef = useRef(false);
  const backoffMsRef = useRef(INITIAL_BACKOFF_MS);
  const cooldownTimerRef = useRef<number | undefined>(undefined);
  const lastSeenUpdatedAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(cooldownTimerRef.current);
  }, []);

  useEffect(() => {
    const evaluate = () => {
      const state = queryClient.getQueryState<boolean>(HEALTH_QUERY_KEY);
      if (!state || state.status === "pending") return;
      // checkAgentHealth resolves the same boolean on every consecutive
      // failed poll, so dataUpdatedAt (fresh on every settled poll,
      // regardless of whether the value repeats) is what tells successive
      // cache notifications apart -- without this guard the cache's other
      // (non-"agent","health") notifications, or the observer's own
      // secondary notify pass, would re-run this same check redundantly.
      if (state.dataUpdatedAt === lastSeenUpdatedAtRef.current) return;
      lastSeenUpdatedAtRef.current = state.dataUpdatedAt;

      if (getAgentMode() !== "embedded") return;

      if (state.data === true) {
        failureCountRef.current = 0;
        recoveringRef.current = false;
        cooldownActiveRef.current = false;
        backoffMsRef.current = INITIAL_BACKOFF_MS;
        window.clearTimeout(cooldownTimerRef.current);
        return;
      }

      if (!recoveringRef.current) {
        failureCountRef.current += 1;
        if (failureCountRef.current < FAILURE_THRESHOLD) return;
        recoveringRef.current = true;
      }

      if (cooldownActiveRef.current) return;

      cooldownActiveRef.current = true;
      void restartAgentProcess().catch(() => {
        // A failed restart attempt just means the next unhealthy tick, once
        // the cooldown below elapses, tries again.
      });
      cooldownTimerRef.current = window.setTimeout(() => {
        cooldownActiveRef.current = false;
        backoffMsRef.current = Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
        // Force a fresh health check now instead of waiting for the next
        // scheduled ~20s poll -- this is what makes the exponential backoff
        // actually drive the retry cadence. The result flows back through
        // the queryCache subscription below exactly like a normal poll
        // would (fresh dataUpdatedAt -> cache notifies -> evaluate() reruns),
        // and since recoveringRef.current is still true, evaluate() will
        // either restart again (if still unhealthy) or fully reset (if
        // recovered) -- never blindly restarting off stale data.
        void queryClient.refetchQueries({ queryKey: HEALTH_QUERY_KEY });
      }, backoffMsRef.current);
    };

    evaluate(); // in case the query already settled before this effect ran
    return queryClient.getQueryCache().subscribe(evaluate);
  }, [queryClient]);
}
