import { useQueryClient } from "@tanstack/react-query";
import { BADGE_TEMPLATE_KEY } from "./hooks";
import { READINESS_KEY } from "../events/hooks";
import { $api } from "../../shared/api/query";

// Task 10's save mutation — the ONE home for
// `$api.useMutation("put", "/api/events/{id}/badge-template")`. This hook
// owns exactly the invalidation side effect that must run UNCONDITIONALLY on
// every successful PUT, regardless of what the calling component's own
// per-call `onSuccess` later decides to do with the response (dispatch
// "saved", clear a conflict, etc. — that orchestration is
// BadgeEditorPage.tsx's job, kept out of this file on purpose):
//
//  - BADGE_TEMPLATE_KEY(eventId) — so this event's OWN badge-template query
//    (and any other mounted consumer, e.g. a future print-preview) refetches
//    the bumped version rather than trusting local optimistic state.
//  - READINESS_KEY(eventId) — the workspace rail's "badge" readiness step
//    flips on template CONTENT (an empty-elements template vs. one with
//    fields bound), which the backend only recomputes from the freshly
//    stored template — nothing else refetches that query (panel/AGENTS.md's
//    "Readiness invalidation" rule, extended to badge template saves here;
//    same PR #66/#70 pattern as the staff/zone/attendee mutations).
//
// Both invalidations fire on EVERY successful save, including the Overwrite
// conflict-resolution retry (that retry re-uses this same mutation instance
// via a second `.mutate()` call) — cache correctness doesn't depend on which
// path produced the 200.
export function useSaveTemplate(eventId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("put", "/api/events/{id}/badge-template", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BADGE_TEMPLATE_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: READINESS_KEY(eventId) });
    },
  });
}
