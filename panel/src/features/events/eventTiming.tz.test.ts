import { classifyEvent } from "./eventTiming";
import type { components } from "../../shared/api/schema";

// Regression guard for the UTC-pinned phase classification (see effectiveEnd
// in eventTiming.ts). It forces a behind-UTC timezone for the duration of
// these tests so it deterministically fails if `effectiveEnd` ever reverts to
// local-time `setHours`. Node re-reads `process.env.TZ` per Date operation, so
// switching it here changes what `Date`'s local methods return; the original
// value is restored afterwards to avoid leaking into other test files that may
// share this worker.
type ApiEvent = components["schemas"]["Event"];

function ev(partial: Partial<ApiEvent>): ApiEvent {
  return { id: "e", tenant_id: "t", name: "E", created_at: "", updated_at: "", ...partial } as ApiEvent;
}

describe("classifyEvent under a behind-UTC timezone (America/New_York)", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York"; // UTC-4 in July (EDT)
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("confirms the test process really is behind UTC", () => {
    // Sanity: guards against an environment where the TZ switch has no effect,
    // which would make the assertions below vacuously pass.
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);
  });

  it("a single-day event stored at UTC midnight is 'running' throughout its UTC day", () => {
    // start_date exactly as the create dialog stores a date-only pick.
    const event = ev({ start_date: "2026-07-20T00:00:00Z" });
    // Noon UTC on the event's own day = 08:00 local (EDT) on Jul 20 — the day
    // the row displays. With local `setHours` this classified as "past".
    expect(classifyEvent(event, new Date("2026-07-20T12:00:00Z"))).toBe("running");
    // Just before the UTC day ends it is still running.
    expect(classifyEvent(event, new Date("2026-07-20T23:30:00Z"))).toBe("running");
    // Once the UTC day is over it is past.
    expect(classifyEvent(event, new Date("2026-07-21T00:30:00Z"))).toBe("past");
  });

  it("a multi-day UTC-midnight event runs through the end of its final UTC day", () => {
    const event = ev({ start_date: "2026-07-18T00:00:00Z", end_date: "2026-07-20T00:00:00Z" });
    expect(classifyEvent(event, new Date("2026-07-20T12:00:00Z"))).toBe("running");
    expect(classifyEvent(event, new Date("2026-07-21T00:30:00Z"))).toBe("past");
  });
});
