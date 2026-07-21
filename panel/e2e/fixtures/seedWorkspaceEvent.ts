import { seedCheckinEvent, type SeedResult } from "./seedCheckinEvent";

export type { SeedResult };

// The a11y sweep needs an event that's reachable at /events/$eventId,
// /events/$eventId/settings, /events/$eventId/attendees, /events/$eventId/badge,
// and /events/$eventId/checkin — all of which only need { token, eventId } (the
// settings and attendees screens) or additionally { stationId } (the check-in
// screen). seedCheckinEvent already provisions an event with an attendee, a
// non-empty badge template, assigned staff, checkin-settings, and a
// registered station, so its SeedResult already covers every field this
// broader sweep needs. Re-exporting it under this name (rather than
// duplicating its 7-step API sequence) keeps the seeding logic in one place.
export async function seedWorkspaceEvent(): Promise<SeedResult> {
  return seedCheckinEvent();
}
