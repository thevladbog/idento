import { $api } from "../../shared/api/query";

// The event's badge template + optimistic-concurrency version (P3.1). The
// response's `template` is `object | null` verbatim from the server — parse
// it with templateTypes.ts's parseTemplateDoc before rendering/editing, and
// keep the raw `data.template` around to pass as serializeTemplateDoc's
// `originalRaw` so unknown keys survive a save (see templateTypes.ts). The
// save mutation itself is Task 10's job; this hook only reads.
export function useBadgeTemplate(eventId: string) {
  return $api.useQuery("get", "/api/events/{id}/badge-template", { params: { path: { id: eventId } } });
}

// Query-key for GET /api/events/{id}/badge-template, matching
// useBadgeTemplate's exact params shape — note the path param is `id`, NOT
// `event_id` (this endpoint uses `{id}`, same as /api/events/{id}/readiness
// — see READINESS_KEY, events/hooks.ts:33). Same verified [method, path,
// init] shape ATTENDEES_LIST_KEY documents (attendees/hooks.ts:49-67):
// openapi-react-query's queryOptions sets queryKey = [method, path, init],
// and TanStack Query's default (non-exact) invalidateQueries match walks
// `Object.keys(filterKey).every(...)` recursively, so this exact-params key
// matches only this one event's badge-template query. Task 10's save
// mutation invalidates this after a successful PUT so the editor's next
// load (and any other mounted consumer, e.g. a print-preview) refetches the
// bumped version rather than trusting local optimistic state. Covered by
// the "BADGE_TEMPLATE_KEY" describe block in hooks.test.tsx.
export function BADGE_TEMPLATE_KEY(eventId: string) {
  return ["get", "/api/events/{id}/badge-template", { params: { path: { id: eventId } } }] as const;
}
