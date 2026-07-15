import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";

type AttendeeListPage = components["schemas"]["AttendeeListPage"];
type AttendeeStatus = "checked_in" | "not_checked_in";

export interface UseAttendeesPageOptions {
  page: number;
  perPage?: number;
  search?: string;
  zone?: string;
  status?: AttendeeStatus;
}

const DEFAULT_PER_PAGE = 50;

// Paginated attendees list. Always passes `page`/`per_page` so the backend
// always returns the AttendeeListPage envelope (never the legacy bare-array
// shape) — see backend/openapi.yaml's getAttendees oneOf. search/zone/status
// are only included when truthy, so empty filters don't get sent as blank
// query params.
export function useAttendeesPage(eventId: string, opts: UseAttendeesPageOptions) {
  const query: { page: number; per_page: number; search?: string; zone?: string; status?: AttendeeStatus } = {
    page: opts.page,
    per_page: opts.perPage ?? DEFAULT_PER_PAGE,
  };
  if (opts.search) query.search = opts.search;
  if (opts.zone) query.zone = opts.zone;
  if (opts.status) query.status = opts.status;

  return $api.useQuery(
    "get",
    "/api/events/{event_id}/attendees",
    { params: { path: { event_id: eventId }, query } },
    // getAttendees' 200 response is typed as Attendee[] | AttendeeListPage
    // (oneOf, discriminated by presence of page/per_page). This hook always
    // sends page/per_page, so the response is always the envelope in
    // practice — narrow the type accordingly.
    { select: (data) => data as AttendeeListPage },
  );
}

// Query-key prefix for GET /api/events/{event_id}/attendees, scoped to a
// single event but matching every page/per_page/search/zone/status variant.
// Pass to queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(id) })
// to refetch the attendees list regardless of which page/filter is open.
//
// Verified shape (not guessed): openapi-react-query's useQuery registers
// queryKey = [method, path, init] where `path` is the raw OpenAPI path
// template (e.g. "/api/events/{event_id}/attendees" — never interpolated
// with the real id) and `init` is `{ params: { path: { event_id }, query:
// {...} } }` (node_modules/openapi-react-query/src/index.ts, queryOptions:
// `queryKey: init === undefined ? [method, path] : [method, path, init]`).
// TanStack Query's default (non-exact) invalidateQueries match is
// partialMatchKey(actualKey, filterKey), which walks
// `Object.keys(filterKey).every(k => partialMatchKey(actualKey[k], filterKey[k]))`
// (@tanstack/query-core/src/utils.ts) — recursing into plain objects the
// same way. So a filter key ending in `{ params: { path: { event_id } } }`
// (no `query` sub-key) matches any actual key whose `params.path.event_id`
// equals `eventId`, regardless of what `params.query` contains — which is
// exactly the "any page/search/zone/status, this event only" prefix match
// this helper needs. Covered by the "ATTENDEES_LIST_KEY" describe block in
// hooks.test.tsx (two same-event queries with different params both
// refetch; a different event's query does not).
export function ATTENDEES_LIST_KEY(eventId: string) {
  return ["get", "/api/events/{event_id}/attendees", { params: { path: { event_id: eventId } } }] as const;
}

// Plain zones list for an event — reused by filters, the bulk assign-zone
// dialog, and the attendee drawer's zone chips.
export function useEventZones(eventId: string) {
  return $api.useQuery("get", "/api/events/{event_id}/zones", { params: { path: { event_id: eventId } } });
}

// A single attendee's full profile — added specifically for Task 8's drawer
// (which needs name/company/code/checkin_status for an id that may not be
// on the currently-loaded list page, e.g. a fresh ?attendee=<id> deep
// link). GET /api/attendees/{id} did not exist before this task's
// prerequisite (commit 9e8c227) — see task-8-report.md for why the table's
// already-fetched row data can't stand in for this.
export function useAttendeeDetail(attendeeId: string) {
  return $api.useQuery("get", "/api/attendees/{id}", { params: { path: { id: attendeeId } } });
}

// Query-key for GET /api/attendees/{id}, matching useAttendeeDetail's exact
// params shape (same verified [method, path, init] shape ATTENDEES_LIST_KEY
// documents above). Task 9's edit-details/regenerate-code flows invalidate
// this alongside ATTENDEES_LIST_KEY so the drawer's own single-attendee
// query reflects the just-saved fields without waiting for the list to
// refetch (and without a full drawer remount).
export function ATTENDEE_DETAIL_KEY(attendeeId: string) {
  return ["get", "/api/attendees/{id}", { params: { path: { id: attendeeId } } }] as const;
}

// Individual per-attendee zone-access overrides (only `allowed: true` rows
// render as chips in the drawer — see AttendeeDrawer.tsx). Also the query
// Task 9's zone-add/remove mutations will invalidate.
export function useAttendeeZoneAccess(attendeeId: string) {
  return $api.useQuery("get", "/api/attendees/{attendee_id}/zone-access", { params: { path: { attendee_id: attendeeId } } });
}

// Query-key for GET /api/attendees/{attendee_id}/zone-access, matching
// useAttendeeZoneAccess's exact params shape. Task 9's zone add/remove
// mutations invalidate only this (never ATTENDEE_DETAIL_KEY — a zone-access
// change doesn't change any field on the Attendee resource itself).
export function ATTENDEE_ZONE_ACCESS_KEY(attendeeId: string) {
  return ["get", "/api/attendees/{attendee_id}/zone-access", { params: { path: { attendee_id: attendeeId } } }] as const;
}

// An attendee's zone movement history, most-recent-first per the API
// contract — the drawer trusts that ordering rather than re-sorting.
export function useAttendeeZoneHistory(attendeeId: string) {
  return $api.useQuery("get", "/api/attendees/{attendee_id}/zone-history", { params: { path: { attendee_id: attendeeId } } });
}
