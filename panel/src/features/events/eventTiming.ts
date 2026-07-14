import type { components } from "../../shared/api/schema";

export type ApiEvent = components["schemas"]["Event"];
export type EventPhase = "running" | "upcoming" | "past";

// End-of-day of the effective end date (end ?? start), so a single-day
// event stays "running" through its whole day.
//
// `start_date`/`end_date` are bare calendar dates that the create dialog
// stores as UTC-midnight ISO timestamps (see CreateEventDialog), and the
// Home rows/strip display them pinned to UTC (see EventRow/LiveStrip,
// commit 252effb). Phase classification is pinned to UTC for the same
// reason: end-of-day must mean the end of the UTC calendar day the value
// denotes, so an event's bucket agrees with the UTC date shown next to it.
// Using local `setHours` here would let a viewer behind UTC see a running
// event as "past" during its own displayed day (e.g. a single-day event
// stored at 2026-07-20T00:00:00Z would classify as "past" for a UTC-4
// viewer by ~00:00 their local time on Jul 20 — the very day the row
// shows). It also keeps classification deterministic regardless of the
// machine timezone the tests run under.
function effectiveEnd(e: ApiEvent): Date | null {
  const raw = e.end_date ?? e.start_date;
  if (!raw) return null;
  const d = new Date(raw);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function classifyEvent(e: ApiEvent, now: Date): EventPhase {
  const start = e.start_date ? new Date(e.start_date) : null;
  const end = effectiveEnd(e);
  if (!start || !end) return "upcoming"; // undated draft
  if (now < start) return "upcoming";
  if (now > end) return "past";
  return "running";
}

export function splitEvents(
  events: ApiEvent[],
  now: Date,
): { running: ApiEvent[]; upcoming: ApiEvent[]; past: ApiEvent[] } {
  const running: ApiEvent[] = [];
  const upcoming: ApiEvent[] = [];
  const past: ApiEvent[] = [];
  for (const e of events) {
    switch (classifyEvent(e, now)) {
      case "running":
        running.push(e);
        break;
      case "upcoming":
        upcoming.push(e);
        break;
      case "past":
        past.push(e);
        break;
    }
  }
  upcoming.sort((a, b) => {
    if (!a.start_date) return b.start_date ? 1 : 0;
    if (!b.start_date) return -1;
    return a.start_date.localeCompare(b.start_date);
  });
  past.sort((a, b) => (effectiveEnd(b)?.getTime() ?? 0) - (effectiveEnd(a)?.getTime() ?? 0));
  return { running, upcoming, past };
}
