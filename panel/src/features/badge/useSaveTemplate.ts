import { useQueryClient } from "@tanstack/react-query";
import { BADGE_TEMPLATE_KEY } from "./hooks";
import { READINESS_KEY } from "../events/hooks";
import { $api } from "../../shared/api/query";

// Task 10's save mutation — the ONE home for
// `$api.useMutation("put", "/api/events/{id}/badge-template")`. This hook
// owns exactly the cache side effects that must run UNCONDITIONALLY on every
// successful PUT, regardless of what the calling component's own per-call
// `onSuccess` later decides to do with the response (dispatch "saved", clear
// a conflict, etc. — that orchestration is BadgeEditorPage.tsx's job, kept
// out of this file on purpose):
//
//  - BADGE_TEMPLATE_KEY(eventId) — seeded directly with `data` (Codex round
//    Fix 3: the PUT response IS this query's exact response shape,
//    `{template, version}`) via `setQueryData`, BEFORE the invalidation
//    below. A consumer that mounts/remounts this query (e.g. the operator
//    navigates away mid-save and back) between this save and the
//    invalidation-triggered refetch actually resolving would otherwise see
//    the STALE pre-save doc/version for however long that refetch takes —
//    long enough, on a slow connection, to build a save against a version
//    the server has already moved past and 409 for no real reason. Also
//    invalidated (not just seeded) so this event's OWN badge-template query
//    (and any other mounted consumer, e.g. a future print-preview) still
//    refetches to double-check the bumped version rather than trusting the
//    seeded value forever.
//  - READINESS_KEY(eventId) — the workspace rail's "badge" readiness step
//    flips on template CONTENT (an empty-elements template vs. one with
//    fields bound), which the backend only recomputes from the freshly
//    stored template — nothing else refetches that query (panel/AGENTS.md's
//    "Readiness invalidation" rule, extended to badge template saves here;
//    same PR #66/#70 pattern as the staff/zone/attendee mutations).
//
// Both the seed and both invalidations key off `variables.params.path.id` —
// the eventId the SETTLING mutate() call actually targeted. This hook
// deliberately takes NO `eventId` argument of its own (a prior version did,
// and used it here) — an argument would have to be threaded through as a
// closure captured at RENDER time, and TanStack Query keeps a mutation
// observer's options current across renders, so if the operator has
// navigated to a different event's editor before an earlier save (kicked off
// against the OLD event) settles, a closure over some OUTER `eventId`
// variable would by then reflect the NEW event and target the WRONG event's
// cache entries. `variables` is exactly what was passed to that specific
// `.mutate()` call and can't drift this way — cache correctness for a given
// save must always follow the event it actually saved, not whatever event
// happens to be on screen when the response arrives. (BadgeEditorPage.tsx's
// OWN reaction to the response — dispatching "saved", writing
// `originalRawRef`, etc. — has this same stale-navigation hazard and is
// guarded separately there, Codex round Fix 4; this hook's cache bookkeeping
// is deliberately unconditional regardless of that guard.)
//
// All of this fires on EVERY successful save, including the Overwrite
// conflict-resolution retry (that retry re-uses this same mutation instance
// via a second `.mutate()` call) — cache correctness doesn't depend on which
// path produced the 200.
export function useSaveTemplate() {
  const queryClient = useQueryClient();
  return $api.useMutation("put", "/api/events/{id}/badge-template", {
    onSuccess: (data, variables) => {
      const targetEventId = variables.params.path.id;
      queryClient.setQueryData(BADGE_TEMPLATE_KEY(targetEventId), data);
      void queryClient.invalidateQueries({ queryKey: BADGE_TEMPLATE_KEY(targetEventId) });
      void queryClient.invalidateQueries({ queryKey: READINESS_KEY(targetEventId) });
    },
  });
}
