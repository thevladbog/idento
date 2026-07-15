import { zoneIdentity } from "./zoneIdentity";
import type { components } from "../api/schema";

type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

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
    ...partial,
  } as EventZone;
}

describe("zoneIdentity", () => {
  it("returns a plain EventZone's own id/name", () => {
    const entry: EventZone = zone({ id: "z1", name: "Main Hall" });
    expect(zoneIdentity(entry)).toEqual({ id: "z1", name: "Main Hall" });
  });

  it("returns the nested zone's id/name for an EventZoneWithStats wrapper", () => {
    const entry: EventZoneWithStats = {
      zone: zone({ id: "z2", name: "VIP" }),
      total_checkins: 10,
      today_checkins: 2,
      assigned_staff: 1,
      access_rules_count: 3,
    };
    expect(zoneIdentity(entry)).toEqual({ id: "z2", name: "VIP" });
  });
});
