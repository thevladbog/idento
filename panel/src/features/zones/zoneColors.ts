import type { components } from "../../shared/api/schema";

type EventZone = components["schemas"]["EventZone"];

// Reconciliation #1 (P2.2 plan): `EventZone` has no `color` field on the
// model (id/event_id/name/zone_type/order_index/open_time/close_time/
// is_registration_zone/requires_registration/is_active/settings/timestamps
// — backend/openapi.yaml). `settings` is the one writable free-form object
// (additionalProperties: true), so the swatch color is persisted there as a
// palette KEY, mapped to a token class in code — never a hex/rgb value.
// Purely decorative (WCAG 1.4.1: the swatch is `aria-hidden`; the
// entrance-subtitle/access-type TEXT carries the actual meaning), so an
// unrecognized or missing `settings.color` (e.g. zones created before this
// existed, or by the old web/ console) falls back to a deterministic
// (stable per zone id, not random-per-render) choice instead of erroring.
export const ZONE_COLOR_KEYS = ["green", "amber", "blue", "slate"] as const;
export type ZoneColorKey = (typeof ZONE_COLOR_KEYS)[number];

export const ZONE_COLOR_CLASSES: Record<ZoneColorKey, string> = {
  green: "bg-success",
  amber: "bg-warning",
  blue: "bg-info",
  slate: "bg-muted-foreground",
};

function isZoneColorKey(value: unknown): value is ZoneColorKey {
  return typeof value === "string" && (ZONE_COLOR_KEYS as readonly string[]).includes(value);
}

// Sum of char codes, not a real hash — deliberately simple: the fallback
// only needs to be stable (same zone id -> same bucket, every render) across
// only 4 buckets, not collision-resistant.
function charCodeSum(value: string): number {
  let sum = 0;
  for (let i = 0; i < value.length; i += 1) sum += value.charCodeAt(i);
  return sum;
}

export function zoneColorKey(zone: EventZone): ZoneColorKey {
  const settingsColor = zone.settings?.color;
  if (isZoneColorKey(settingsColor)) return settingsColor;
  return ZONE_COLOR_KEYS[charCodeSum(zone.id) % ZONE_COLOR_KEYS.length];
}
