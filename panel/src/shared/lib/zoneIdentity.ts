import type { components } from "../api/schema";

type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

// `GET /api/events/{event_id}/zones` returns a union not discriminated by any
// param the callers below send (with_stats wraps each zone as
// EventZoneWithStats, nesting the actual zone under `.zone`) — this narrows
// it to a plain { id, name } shape. Matching across the two call shapes is
// always by id, never by name.
export type ZoneListEntry = EventZone | EventZoneWithStats;

export function zoneIdentity(entry: ZoneListEntry): { id: string; name: string } {
  return "zone" in entry ? { id: entry.zone.id, name: entry.zone.name } : { id: entry.id, name: entry.name };
}
