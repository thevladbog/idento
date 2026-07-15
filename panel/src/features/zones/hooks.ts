import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";

type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

// Stats-annotated zones list for the Zones page (board 6b) — each entry
// pairs the zone with total_checkins/today_checkins/assigned_staff/
// access_rules_count. Distinct from attendees/hooks.ts' `useEventZones`
// (plain list, used by filters/the bulk assign-zone dialog/the attendee
// drawer's zone chips) — those consumers don't need the stats and
// shouldn't pay for the backend computing them.
//
// `with_stats` is typed as a plain `string` on the OpenAPI operation
// (getEventZones's `query.with_stats?: string` — "Exact string match
// against \"true\" (not a real boolean parse)", schema.d.ts), not a real
// boolean: passing the JS boolean `true` fails typecheck ("Type 'boolean'
// is not assignable to type 'string'", verified directly against
// tsconfig.app.json). The literal string "true" is both the type-correct
// AND the semantically-correct value — it's exactly what the backend
// string-compares against.
export function useEventZonesWithStats(eventId: string) {
  return $api.useQuery(
    "get",
    "/api/events/{event_id}/zones",
    { params: { path: { event_id: eventId }, query: { with_stats: "true" } } },
    // getEventZones' 200 response is typed as EventZone[] | EventZoneWithStats[]
    // (oneOf, discriminated by with_stats). This hook always sends
    // with_stats=true, so the response is always the stats-annotated shape
    // in practice — narrow the type accordingly (same pattern as
    // attendees/hooks.ts' useAttendeesPage).
    { select: (data) => data as EventZoneWithStats[] },
  );
}

// Query-key prefix for GET /api/events/{event_id}/zones, scoped to a single
// event but matching BOTH this hook's with_stats=true variant AND
// attendees/hooks.ts' useEventZones plain variant — same path, no `query`
// sub-key in the filter key. Mirrors ATTENDEES_LIST_KEY's verified
// partial-match shape (attendees/hooks.ts:49-67): TanStack Query's default
// invalidateQueries match walks only the keys present in the filter, so a
// filter ending in `{ params: { path: { event_id } } }` (no `query` key)
// matches any actual key whose `params.path.event_id` equals `eventId`,
// regardless of whether that actual key's `params` even has a `query`
// sub-key at all (the plain useEventZones call has none; the with_stats
// call has `query: { with_stats: "true" }`) — exactly the "both variants,
// this event only" prefix this helper needs. Covered by the "ZONES_KEY"
// describe block in hooks.test.tsx.
export function ZONES_KEY(eventId: string) {
  return ["get", "/api/events/{event_id}/zones", { params: { path: { event_id: eventId } } }] as const;
}
