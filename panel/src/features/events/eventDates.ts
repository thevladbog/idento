import type { ApiEvent } from "./eventTiming";

// A single date, or "start – end" when the dates differ, in the viewer's
// locale — no date library per plan constraints. `start_date`/`end_date`
// are bare calendar dates stored as UTC-midnight ISO timestamps (see
// CreateEventDialog), so the formatter is pinned to UTC to keep the
// displayed date stable regardless of the viewer's local timezone (without
// it, viewers behind UTC see the date roll back by one day).
//
// Extracted from LiveStrip.tsx (P1.1) so the workspace header (P1.2 Task 2)
// can reuse the exact same UTC-pinned formatting instead of re-deriving it.
export function formatDateRange(event: ApiEvent, locale: string): string | null {
  if (!event.start_date) return null;
  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const start = dateFmt.format(new Date(event.start_date));
  if (!event.end_date) return start;
  const end = dateFmt.format(new Date(event.end_date));
  return start === end ? start : `${start} – ${end}`;
}
