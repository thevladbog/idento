// Typed search params for the /_app/events/$eventId/attendees route.
// `attendee` (a selected attendee's id) is reserved for Task 8's drawer —
// declared here so the type is stable, but nothing in Task 5 reads it.
export interface AttendeesSearch {
  page?: number;
  search?: string;
  zone?: string;
  status?: "checked_in" | "not_checked_in";
  attendee?: string;
}

// Route-level `validateSearch`. Kept in its own module (not inlined in
// app/router.tsx) so both the real route definition and this feature's own
// test harnesses — which build a throwaway route tree shaped like the real
// one purely so `getRouteApi(...).useSearch()` resolves — import the exact
// same parsing logic instead of risking two copies drifting apart.
//
// TanStack Router's default `parseSearch` already JSON-parses each raw query
// string value (see @tanstack/router-core's `parseSearchWith(JSON.parse)`),
// so a numeric `?page=2` arrives here already as the number `2`, not the
// string `"2"` — this only needs to narrow/validate, not do its own
// string->number coercion.
export function validateAttendeesSearch(search: Record<string, unknown>): AttendeesSearch {
  const page = typeof search.page === "number" && Number.isFinite(search.page) ? search.page : undefined;
  const searchText = typeof search.search === "string" && search.search !== "" ? search.search : undefined;
  const zone = typeof search.zone === "string" && search.zone !== "" ? search.zone : undefined;
  const status = search.status === "checked_in" || search.status === "not_checked_in" ? search.status : undefined;
  const attendee = typeof search.attendee === "string" && search.attendee !== "" ? search.attendee : undefined;
  return { page, search: searchText, zone, status, attendee };
}
