import type { components } from "../../shared/api/schema";

export type ApiEvent = components["schemas"]["Event"];
export type EventPhase = "running" | "upcoming" | "past";

// End-of-day of the effective end date (end ?? start), so a single-day
// event stays "running" through its whole day.
function effectiveEnd(e: ApiEvent): Date | null {
  const raw = e.end_date ?? e.start_date;
  if (!raw) return null;
  const d = new Date(raw);
  d.setHours(23, 59, 59, 999);
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
