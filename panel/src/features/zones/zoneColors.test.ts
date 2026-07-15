import { ZONE_COLOR_CLASSES, ZONE_COLOR_KEYS, zoneColorKey } from "./zoneColors";
import type { components } from "../../shared/api/schema";

type EventZone = components["schemas"]["EventZone"];

function zone(partial: Partial<EventZone>): EventZone {
  return {
    id: "z1",
    event_id: "e1",
    name: "Main Hall",
    zone_type: "general",
    order_index: 0,
    is_registration_zone: false,
    requires_registration: false,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  } as EventZone;
}

describe("zoneColorKey", () => {
  it("honors a valid settings.color", () => {
    expect(zoneColorKey(zone({ id: "z1", settings: { color: "amber" } }))).toBe("amber");
    expect(zoneColorKey(zone({ id: "z1", settings: { color: "blue" } }))).toBe("blue");
    expect(zoneColorKey(zone({ id: "z1", settings: { color: "slate" } }))).toBe("slate");
    expect(zoneColorKey(zone({ id: "z1", settings: { color: "green" } }))).toBe("green");
  });

  it("falls back to a deterministic color, stable across repeated calls, when settings is missing entirely", () => {
    const z = zone({ id: "no-settings-zone", settings: undefined });
    const first = zoneColorKey(z);
    const second = zoneColorKey(z);
    expect(first).toBe(second);
    expect(ZONE_COLOR_KEYS).toContain(first);
  });

  it("falls back to the same deterministic color when settings.color is an unrecognized value", () => {
    const withUnknownColor = zone({ id: "purple-zone", settings: { color: "purple" } });
    const withNoColor = zone({ id: "purple-zone", settings: {} });
    expect(zoneColorKey(withUnknownColor)).toBe(zoneColorKey(withNoColor));
  });

  it("computes the documented fallback formula (charCodeSum(id) % ZONE_COLOR_KEYS.length) when there's no usable settings.color", () => {
    // "z1": 'z' (122) + '1' (49) = 171; 171 % 4 = 3 -> ZONE_COLOR_KEYS[3] = "slate"
    expect(zoneColorKey(zone({ id: "z1", settings: undefined }))).toBe("slate");
    // "z2": 'z' (122) + '2' (50) = 172; 172 % 4 = 0 -> ZONE_COLOR_KEYS[0] = "green"
    expect(zoneColorKey(zone({ id: "z2", settings: undefined }))).toBe("green");
  });

  it("maps every color key to a token utility class — never a hardcoded hex/rgb value", () => {
    expect(ZONE_COLOR_KEYS).toEqual(["green", "amber", "blue", "slate"]);
    for (const key of ZONE_COLOR_KEYS) {
      expect(ZONE_COLOR_CLASSES[key]).toMatch(/^bg-[a-z-]+$/);
    }
  });
});
