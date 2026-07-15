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

// A single zone's access-rule set (Task 4, the inline OR-rule builder).
// GET /api/zones/{zone_id}/access-rules returns the FULL rule list — both
// the "simple" allow-rules the sentence UI can edit and the "complex" ones
// (allowed: false, or either time bound set) it can only pass through
// read-only. ZoneRuleEditor.tsx does that simple/complex split; this hook
// just fetches the raw array.
export function useZoneAccessRules(zoneId: string) {
  return $api.useQuery("get", "/api/zones/{zone_id}/access-rules", { params: { path: { zone_id: zoneId } } });
}

// Query-key for a single zone's access-rules GET, scoped to that zone only
// (unlike ZONES_KEY above, there's no cross-shape variant to prefix-match
// here — one path, one query key). Save must invalidate this AND
// ZONES_KEY(eventId) together: the PUT's `{message}`-only response can't
// patch either cache directly, and the zones list's access-type text reads
// `access_rules_count`, which only a ZONES_KEY refetch will pick up.
export function ZONE_RULES_KEY(zoneId: string) {
  return ["get", "/api/zones/{zone_id}/access-rules", { params: { path: { zone_id: zoneId } } }] as const;
}
