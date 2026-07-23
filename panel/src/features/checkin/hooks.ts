import { useQueryClient } from "@tanstack/react-query";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { ATTENDEE_DETAIL_KEY, ATTENDEES_LIST_KEY } from "../attendees/hooks";
import { parseCheckinSettings, type CheckinSettings } from "./settingsTypes";

// Re-exported schema types for Task 6+ consumers (mirrors staff/hooks.ts'
// StaffUser/StaffZoneAssignment precedent) — keeps the generated schema
// index paths out of every downstream file that just needs the shape.
export type CheckinStation = components["schemas"]["CheckinStation"];
export type CheckinActionRow = components["schemas"]["CheckinActionRow"];
export type CheckinOutcome = components["schemas"]["CheckinOutcome"];
export type StationCheckinResponse = components["schemas"]["StationCheckinResponse"];

// ---------------------------------------------------------------------------
// Check-in settings — GET/PUT /api/events/{id}/checkin-settings. Note the
// path param is `id`, NOT `event_id` (same quirk as events/hooks.ts'
// useEventReadiness and badge/hooks.ts' useBadgeTemplate — this operation's
// OpenAPI path literally spells it `{id}`, schema.d.ts:275+).
// ---------------------------------------------------------------------------

// GET's `.select` runs parseCheckinSettings on the raw `{settings: object |
// null}` envelope so every consumer of this hook always gets a fully
// populated CheckinSettings — never null, never a partial object — without
// re-deriving defaults at each call site (settingsTypes.ts owns that logic).
export function useCheckinSettings(eventId: string) {
  return $api.useQuery(
    "get",
    "/api/events/{id}/checkin-settings",
    { params: { path: { id: eventId } } },
    { select: (data) => parseCheckinSettings(data.settings) },
  );
}

// Query-key for GET /api/events/{id}/checkin-settings, matching
// useCheckinSettings' exact params shape. Same verified [method, path, init]
// shape ATTENDEES_LIST_KEY documents (attendees/hooks.ts:49-67).
export function CHECKIN_SETTINGS_KEY(eventId: string) {
  return ["get", "/api/events/{id}/checkin-settings", { params: { path: { id: eventId } } }] as const;
}

// Saves the event's check-in settings. Unlike badge/useSaveTemplate.ts (which
// deliberately takes NO eventId argument, keying its cache effects off
// `variables.params.path.id` to survive a mid-save navigation to a different
// event — see that file's own comment), this hook mirrors every OTHER
// per-event hook in this module and takes `eventId` directly: check-in
// settings have no optimistic-concurrency version and are only ever edited
// from the single-event launch ceremony (Task 11), which doesn't carry the
// same stale-navigation hazard the badge editor's save-retry flow does.
export function useSaveCheckinSettings(eventId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("put", "/api/events/{id}/checkin-settings", {
    onSuccess: (data) => {
      queryClient.setQueryData(CHECKIN_SETTINGS_KEY(eventId), data);
      void queryClient.invalidateQueries({ queryKey: CHECKIN_SETTINGS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in stations — register / heartbeat / list
// (/api/events/{event_id}/checkin-stations*).
// ---------------------------------------------------------------------------

export function useCheckinStations(eventId: string) {
  return $api.useQuery("get", "/api/events/{event_id}/checkin-stations", {
    params: { path: { event_id: eventId } },
  });
}

// Query-key for GET /api/events/{event_id}/checkin-stations, scoped to one
// event (there's only one query-param shape for this path, so this is a
// plain exact-path prefix rather than a cross-shape one — same reasoning as
// STAFF_KEY, staff/hooks.ts:29).
export function CHECKIN_STATIONS_KEY(eventId: string) {
  return ["get", "/api/events/{event_id}/checkin-stations", { params: { path: { event_id: eventId } } }] as const;
}

// Registers (or re-registers/upserts) a named station. Invalidates the
// station list unconditionally on every success — an upsert always changes
// either a brand-new row or an existing one's zone_id/last_seen_at, so
// there's no outcome where the list should stay stale.
export function useRegisterStation(eventId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/events/{event_id}/checkin-stations", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY(eventId) });
    },
  });
}

// Refreshes a station's last_seen_at (Task 12 mounts this on a 20s
// interval). Also invalidates the station list — a later online/offline
// indicator (schema.d.ts's heartbeatCheckinStation comment: "so the panel
// can show online/offline state") reads last_seen_at off this same list, and
// invalidateQueries is a no-op refetch-wise unless that list actually has a
// mounted observer, so this costs nothing when nobody's watching yet.
export function useStationHeartbeat(eventId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/events/{event_id}/checkin-stations/{id}/heartbeat", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY(eventId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in actions feed — GET /api/events/{event_id}/checkin-actions.
// ---------------------------------------------------------------------------

export function useCheckinActions(eventId: string, limit = 50) {
  return $api.useQuery("get", "/api/events/{event_id}/checkin-actions", {
    params: { path: { event_id: eventId }, query: { limit } },
  });
}

// Query-key PREFIX for GET /api/events/{event_id}/checkin-actions — matches
// every `limit` variant for the given event (no `query` sub-key), same
// pattern as ATTENDEES_LIST_KEY (attendees/hooks.ts:65-67): TanStack Query's
// default (non-exact) invalidateQueries match walks
// `Object.keys(filterKey).every(...)` recursively, so a filter key ending in
// `{params: {path: {event_id}}}` (no `query`) matches any actual key whose
// `params.path.event_id` equals `eventId`, regardless of `params.query.limit`.
export function CHECKIN_ACTIONS_KEY(eventId: string) {
  return ["get", "/api/events/{event_id}/checkin-actions", { params: { path: { event_id: eventId } } }] as const;
}

// ---------------------------------------------------------------------------
// Station check-in / undo — POST /api/events/{event_id}/checkin[/undo].
// ---------------------------------------------------------------------------

// Fires the idempotent single-scan check-in. Unconditionally invalidates
// CHECKIN_ACTIONS_KEY (a checked_in outcome adds a feed row; already_
// checked_in/blocked don't, but re-fetching an unchanged feed is harmless)
// and ATTENDEES_LIST_KEY (a checked_in outcome flips the attendee's
// checkin_status, which the attendees table/roster must reflect) — this is
// the "unconditional invalidation" mutation-hygiene rule from the phase plan
// applied at the one shared call site, so every consumer (Task 6's
// useCheckinFlow, and any other future caller) gets it for free rather than
// each having to remember it.
export function useStationCheckin(eventId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/events/{event_id}/checkin", {
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      // P6.3's AttendeeCard keeps a detail view open across this mutation
      // (attendees/hooks.ts:139/149 already invalidate this key from
      // block/unblock for the same reason) — without it the open card goes
      // stale indefinitely since useAttendeeDetail isn't part of the
      // attendees-list query this hook was originally written to refresh.
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_DETAIL_KEY(variables.body.attendee_id) });
    },
  });
}

// Clears a check-in (idempotent — see schema.d.ts's undoCheckin comment).
// Same unconditional-invalidation rationale as useStationCheckin above; also
// exactly what Task 9's recent-scans rail needs for its own Undo row (its
// own interface note: "both invalidate CHECKIN_ACTIONS_KEY +
// ATTENDEES_LIST_KEY" — already satisfied here, no per-caller duplication
// required).
export function useUndoCheckin(eventId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/events/{event_id}/checkin/undo", {
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      // Same rationale as useStationCheckin above — keeps an open AttendeeCard
      // (P6.3) in sync instead of showing a stale checked-in state forever.
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_DETAIL_KEY(variables.body.attendee_id) });
    },
  });
}

export type { CheckinSettings };
