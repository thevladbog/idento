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

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/events", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["get", "/api/events"] });
    },
  });
}
