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
