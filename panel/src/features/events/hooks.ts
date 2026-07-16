import { useQueryClient } from "@tanstack/react-query";
import { $api } from "../../shared/api/query";

export function useEventsQuery() {
  return $api.useQuery("get", "/api/events");
}

export function useEventStats(eventId: string, opts?: { poll?: boolean }) {
  return $api.useQuery(
    "get",
    "/api/events/{event_id}/stats",
    { params: { path: { event_id: eventId } } },
    { refetchInterval: opts?.poll ? 15_000 : undefined },
  );
}

export function useEventReadiness(eventId: string) {
  return $api.useQuery("get", "/api/events/{id}/readiness", { params: { path: { id: eventId } } });
}

// Query-key for GET /api/events/{id}/readiness, matching useEventReadiness's
// exact params shape — note the path param is `id`, NOT `event_id` (this
// endpoint's OpenAPI operation names it differently from the staff/zones
// list endpoints, so a copy-pasted `event_id` key would silently match
// nothing). Same verified [method, path, init] shape ATTENDEES_LIST_KEY
// documents (attendees/hooks.ts:49-67). The backend recomputes the
// staff/zones readiness steps from the LIVE staff/zone lists, so every
// mutation that changes those counts (assign/revoke staff, create/delete
// zone) must invalidate this alongside its own list key — the workspace
// rail and the "Launch check-in" gate render from this query in the
// always-mounted EventWorkspaceLayout, and nothing else refetches it.
// Covered by the "READINESS_KEY" describe block in hooks.test.tsx.
export function READINESS_KEY(eventId: string) {
  return ["get", "/api/events/{id}/readiness", { params: { path: { id: eventId } } }] as const;
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/events", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["get", "/api/events"] });
    },
  });
}
