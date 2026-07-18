// Typed search params + route guard for the /_app/events/$eventId/checkin
// route (P4.1 Task 8). `station` is the registered check-in station's id --
// set by the launch ceremony (Task 11) when it navigates here after
// registering the station. Kept in its own module (not inlined in
// app/router.tsx), mirroring attendees/searchParams.ts's
// validateAttendeesSearch precedent exactly: both the real route
// definition (app/router.tsx) and this feature's own routed test harness
// (StationPage.test.tsx) import the SAME parsing/guard logic, so the two
// can never silently drift apart.
import { redirect } from "@tanstack/react-router";

export interface CheckinStationSearch {
  station?: string;
}

// PR #77 bot-review round, Finding G -- format-only validation. Station ids
// are server-generated UUIDs (backend/internal/handler/checkin_stations.go's
// own uuid.Parse); a `?station=` that isn't UUID-SHAPED can never resolve to
// a real station, so accepting it verbatim just deferred the failure to
// StationPage's own heartbeat/check-in calls, which would then 400 in a loop
// instead of the intended redirect-to-launch-ceremony. Deliberately FORMAT
// ONLY -- this module has no access to (and must never gain) the registered
// station list: a well-formed but hypothetically-unregistered UUID is NOT
// rejected here (see StationPage.tsx's own file-header comment for why that
// distinction is a deliberate design decision, not an oversight).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A missing, empty, non-string, or non-UUID-shaped `station` search value
// all collapse to `undefined` here -- "missing" and "malformed" are handled
// identically by the beforeLoad guard below (checkinStationBeforeLoad),
// matching the brief's own phrasing ("Missing/invalid ?station= ...
// redirect").
export function validateCheckinStationSearch(search: Record<string, unknown>): CheckinStationSearch {
  const raw = typeof search.station === "string" ? search.station : "";
  const station = UUID_PATTERN.test(raw) ? raw : undefined;
  return { station };
}

// Route-level `beforeLoad` guard: you can't run a check-in station without
// having registered one first (Task 11's launch ceremony is the only thing
// that navigates here WITH a `?station=<id>`), so an absent/invalid value
// redirects to the launch ceremony BEFORE StationPage ever mounts -- the
// component itself can then assume `search.station` is always a non-empty
// string.
//
// `href` (not `to`): `/events/$eventId/checkin/launch` isn't a registered
// route yet (Task 11 creates it) -- app/router.tsx's `Register` module
// augmentation makes every `to`/`redirect({ to })` call statically checked
// against the CURRENT route tree, so a not-yet-registered path would fail
// to typecheck. `href` is a plain string, resolved at runtime instead of
// compile time, and -- per `redirect()`'s own implementation -- only forces
// a full-document reload when it parses as an ABSOLUTE URL (`new URL(href)`
// succeeding); this relative in-app path does not, so it stays a normal SPA
// redirect.
export function checkinStationBeforeLoad({
  params,
  search,
}: {
  params: { eventId: string };
  search: CheckinStationSearch;
}): void {
  if (!search.station) {
    throw redirect({ href: `/events/${params.eventId}/checkin/launch` });
  }
}
