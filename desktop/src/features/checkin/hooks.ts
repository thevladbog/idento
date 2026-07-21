// TanStack Query wrappers over the existing axios instance (lib/api.ts) for
// the backend's server-side check-in loop (P4.1), and over the local
// hardware agent's default-printer probe. Mirrors panel/src/features/
// checkin/hooks.ts's query-key/invalidation shape, hand-typed against axios
// instead of openapi-fetch (desktop has no generated typed client).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { agentGet, checkAgentHealth } from "../../lib/agent";
import { parseCheckinSettings, type CheckinSettings } from "./settingsTypes";
import type { CheckinActionRow, CheckinStation, StationCheckinResponse } from "./types";

// ---------------------------------------------------------------------------
// Event -- GET /api/events/{id}. Only the fields this feature needs.
// ---------------------------------------------------------------------------

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      const { data } = await api.get<{ id: string; name: string }>(`/api/events/${eventId}`);
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in settings -- GET/PUT /api/events/{id}/checkin-settings. Path param
// is `id`, not `event_id` (openapi.yaml's own spelling for this operation).
// ---------------------------------------------------------------------------

export function CHECKIN_SETTINGS_KEY(eventId: string) {
  return ["checkin-settings", eventId] as const;
}

export function useCheckinSettings(eventId: string) {
  return useQuery({
    queryKey: CHECKIN_SETTINGS_KEY(eventId),
    queryFn: async () => {
      const { data } = await api.get<{ settings: CheckinSettings | null }>(`/api/events/${eventId}/checkin-settings`);
      return parseCheckinSettings(data.settings);
    },
  });
}

export function useSaveCheckinSettings(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: CheckinSettings) => {
      const { data } = await api.put<{ settings: CheckinSettings | null }>(`/api/events/${eventId}/checkin-settings`, { settings });
      return parseCheckinSettings(data.settings);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CHECKIN_SETTINGS_KEY(eventId), data);
      void queryClient.invalidateQueries({ queryKey: CHECKIN_SETTINGS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in stations -- register / heartbeat / list
// (/api/events/{event_id}/checkin-stations*).
// ---------------------------------------------------------------------------

export function CHECKIN_STATIONS_KEY(eventId: string) {
  return ["checkin-stations", eventId] as const;
}

export function useCheckinStations(eventId: string) {
  return useQuery({
    queryKey: CHECKIN_STATIONS_KEY(eventId),
    queryFn: async () => {
      const { data } = await api.get<{ stations: CheckinStation[] }>(`/api/events/${eventId}/checkin-stations`);
      return data.stations;
    },
  });
}

export function useRegisterStation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; zone_id?: string | null }) => {
      const { data } = await api.post<{ station: CheckinStation }>(`/api/events/${eventId}/checkin-stations`, body);
      return data.station;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY(eventId) });
    },
  });
}

export function useStationHeartbeat(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stationId: string) => {
      await api.post(`/api/events/${eventId}/checkin-stations/${stationId}/heartbeat`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in actions feed -- GET /api/events/{event_id}/checkin-actions.
// ---------------------------------------------------------------------------

export function CHECKIN_ACTIONS_KEY(eventId: string) {
  return ["checkin-actions", eventId] as const;
}

export function useCheckinActions(eventId: string, limit = 50) {
  return useQuery({
    queryKey: [...CHECKIN_ACTIONS_KEY(eventId), limit],
    queryFn: async () => {
      const { data } = await api.get<{ actions: CheckinActionRow[] }>(`/api/events/${eventId}/checkin-actions`, {
        params: { limit },
      });
      return data.actions;
    },
  });
}

// ---------------------------------------------------------------------------
// Station check-in -- POST /api/events/{event_id}/checkin.
// ---------------------------------------------------------------------------

export function useStationCheckin(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { attendee_id: string; station_id: string | null }) => {
      const { data } = await api.post<StationCheckinResponse>(`/api/events/${eventId}/checkin`, body);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Print-counter bump + optional reprint audit -- POST /api/attendees/{id}/printed.
// A body is sent only when eventId is present -- an absent body is the
// pre-existing counter-only back-compat path (no checkin_actions row).
// ---------------------------------------------------------------------------

export function useMarkAttendeePrinted() {
  return useMutation({
    mutationFn: async ({ attendeeId, eventId, stationId }: { attendeeId: string; eventId?: string; stationId?: string | null }) => {
      const { data } = await api.post<{ printed_count: number }>(
        `/api/attendees/${attendeeId}/printed`,
        eventId ? { event_id: eventId, station_id: stationId ?? null } : undefined,
      );
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Agent default printer -- GET /printers/default (agent, not backend).
// ---------------------------------------------------------------------------

export function useAgentDefaultPrinter() {
  return useQuery({
    queryKey: ["agent", "default-printer"],
    queryFn: async () => {
      const text = await agentGet("/printers/default");
      const parsed = JSON.parse(text) as { default?: string | null };
      return parsed.default ?? null;
    },
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Agent health -- GET /health (agent, not backend).
// ---------------------------------------------------------------------------

export function useAgentHealth() {
  return useQuery({
    queryKey: ["agent", "health"],
    queryFn: checkAgentHealth,
    refetchInterval: 20_000,
    retry: false,
  });
}
