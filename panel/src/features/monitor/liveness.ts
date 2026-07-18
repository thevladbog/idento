// P4.2 Task 8 -- pure staleness math for the live monitor's Stations card
// (board 7e, p4.2-board-7e-extract.md): a per-row amber dot PLUS a "stale
// Ns" duration label, never a binary online/offline flag -- the board's own
// answer to P4.1's punted "how stale is stale" question. Pure and
// unit-tested in isolation (liveness.test.ts) so StationsCard.tsx just
// calls this once per row per render, driven by MonitorPage's existing 1s
// ticker (`now`) -- no second ticker/interval is introduced here.
//
// 45s (not the 20s heartbeat cadence itself, which stays untouched from
// P4.1) per the plan's Global Constraints: a station is only flagged stale
// after missing more than two heartbeats, giving one heartbeat's worth of
// slack for ordinary network jitter before the operator sees anything.
export const STATION_STALE_MS = 45_000;

export interface StationStaleness {
  stale: boolean;
  seconds: number;
}

/**
 * `lastSeenAt` -- an ISO-8601 timestamp (checkin_stations.last_seen_at,
 * mirrored into MonitorStationRow). `now` -- caller-supplied epoch ms
 * (MonitorPage's own 1s ticker state), never `Date.now()` read internally,
 * so this stays pure and trivially testable.
 */
export function stationStaleness(lastSeenAt: string, now: number): StationStaleness {
  const elapsedMs = Math.max(0, now - Date.parse(lastSeenAt));
  const seconds = Math.floor(elapsedMs / 1000);
  return { stale: elapsedMs > STATION_STALE_MS, seconds };
}
