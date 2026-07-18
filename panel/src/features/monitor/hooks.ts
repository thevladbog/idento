import { $api } from "../../shared/api/query";

// Live monitor snapshot — GET /api/events/{event_id}/monitor (P4.2 Task 3,
// spec §3.1). No refetchInterval: this is a read-once-then-invalidate model,
// not a poller — Task 6's useMonitorStream keeps it fresh by invalidating
// MONITOR_SNAPSHOT_KEY below whenever the SSE stream's thin "update" pings
// arrive (coalesced to <=1/sec), and on reconnect. Unlike useEventStats
// (events/hooks.ts:8, `refetchInterval: opts?.poll ? 15_000 : undefined`),
// there's no polling fallback here per the plan's global constraints — a
// dead stream shows a "reconnecting" badge over stale data instead.
export function useMonitorSnapshot(eventId: string) {
  return $api.useQuery("get", "/api/events/{event_id}/monitor", { params: { path: { event_id: eventId } } });
}

// Query-key for GET /api/events/{event_id}/monitor, matching
// useMonitorSnapshot's exact params shape. Same verified [method, path,
// init] shape READINESS_KEY documents (events/hooks.ts:33) — see that
// comment for the underlying openapi-react-query queryKey mechanics
// (queryKey: [method, path, init]) and TanStack Query's partial-match
// invalidateQueries semantics this relies on: a filter key of exactly this
// shape (no extra query sub-key on this endpoint, so there's nothing looser
// to match on) matches only the same event's monitor query. Task 6's
// useMonitorStream is the intended (and, at this task, only) consumer —
// every SSE "update" frame invalidates this key to trigger a re-fetch.
// Covered by the "MONITOR_SNAPSHOT_KEY" describe block in hooks.test.tsx.
export function MONITOR_SNAPSHOT_KEY(eventId: string) {
  return ["get", "/api/events/{event_id}/monitor", { params: { path: { event_id: eventId } } }] as const;
}
