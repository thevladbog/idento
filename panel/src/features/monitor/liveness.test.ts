// P4.2 Task 8 -- pure staleness math for the Stations card (board 7e:
// a per-row amber dot + "stale Ns" duration label, never a binary
// online/offline flag). STATION_STALE_MS is the plan's Global Constraints
// number verbatim (45s) -- heartbeat cadence itself stays 20s (P4.1,
// untouched), so a station is only flagged stale after missing more than
// two heartbeats.
import { STATION_STALE_MS, stationStaleness } from "./liveness";

describe("STATION_STALE_MS", () => {
  it("is 45 seconds, per the plan's Global Constraints", () => {
    expect(STATION_STALE_MS).toBe(45_000);
  });
});

describe("stationStaleness", () => {
  const lastSeenAt = "2026-07-18T12:00:00.000Z";
  const lastSeenMs = Date.parse(lastSeenAt);

  it("is fresh just under the 45s threshold (44.9s since last-seen)", () => {
    const now = lastSeenMs + 44_900;
    expect(stationStaleness(lastSeenAt, now)).toEqual({ stale: false, seconds: 44 });
  });

  it("is stale just over the 45s threshold (45.1s since last-seen), reporting the elapsed whole seconds", () => {
    const now = lastSeenMs + 45_100;
    expect(stationStaleness(lastSeenAt, now)).toEqual({ stale: true, seconds: 45 });
  });

  it("is fresh at 0s (a heartbeat that just landed)", () => {
    expect(stationStaleness(lastSeenAt, lastSeenMs)).toEqual({ stale: false, seconds: 0 });
  });

  it("keeps reporting a growing seconds count well past the threshold", () => {
    const now = lastSeenMs + 125_000;
    expect(stationStaleness(lastSeenAt, now)).toEqual({ stale: true, seconds: 125 });
  });
});
