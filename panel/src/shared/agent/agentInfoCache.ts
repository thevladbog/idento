import { getAgentBaseUrl } from "../api/http";
import type { AgentInfo } from "./agentClient";

// Board 5d: "Saved devices must be renderable WITHOUT the agent: the
// registry (and the machine's identity) must be readable when the agent is
// down." This is the machine-identity half of that requirement -- the
// equipment hub's own saved-devices registry is a separate, server-backed
// concern (Task 2/3); this is purely a last-known-good LOCAL cache of
// GET /info's response, read while the agent is unreachable.
//
// Keyed by the agent's base URL (not a fixed key) because a panel machine
// can point at a different local agent between sessions -- most concretely,
// today's test suite, which swaps window.__ENV__.AGENT_URL between test
// files/cases and must never leak one agent's cached identity into another's
// read.
function cacheKey(): string {
  return `idento.agent-info.${getAgentBaseUrl()}`;
}

/**
 * Returns the last-written AgentInfo for the CURRENT agent base URL, or null
 * if nothing has been cached yet, or if the stored value is malformed JSON
 * (a corrupted/hand-edited localStorage entry) -- in the malformed case the
 * bad key is removed so it doesn't keep failing to parse on every future
 * read, same "read, try/catch, remove-on-failure" idiom as
 * shared/api/session.ts's getCurrentUser/getTenants/getCurrentTenant.
 */
export function readCachedAgentInfo(): AgentInfo | null {
  const key = cacheKey();
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AgentInfo;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/**
 * Persists `info` as the last-known identity for the current agent base URL.
 *
 * Warn-don't-fail on a throwing `setItem` (Safari private mode, quota
 * exceeded): this runs inside useAgentInfo's queryFn AFTER a successful
 * health + /info probe, so letting the exception propagate would reject the
 * whole query and falsely report a perfectly healthy agent as
 * "disconnected". Identity caching is a convenience (board 5d's
 * show-identity-while-down fallback) and must never take connectivity down
 * with it -- the only cost of a swallowed failure is a stale/absent
 * cachedInfo during a LATER disconnect.
 */
export function writeCachedAgentInfo(info: AgentInfo): void {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(info));
  } catch (error) {
    console.warn("failed to cache agent identity (private mode / quota?)", error);
  }
}
