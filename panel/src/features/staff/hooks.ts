import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";

// The FULL generated User shape (id/tenant_id/email/role/is_super_admin/
// has_qr_token/qr_token_created_at?/created_at/updated_at) — NOT the
// narrowed `Pick` alias in shared/api/types.ts, which deliberately drops
// is_super_admin/has_qr_token/qr_token_created_at (no existing panel code
// read them). This feature needs has_qr_token/qr_token_created_at for the
// QR card area (Task 6's lost/reissue state), so the full schema type is
// used directly instead.
export type StaffUser = components["schemas"]["User"];
export type StaffZoneAssignment = components["schemas"]["StaffZoneAssignment"];

// Assigned staff for an event — GET .../staff joins event_staff back to
// users, so this is an array of FULL User records (email/role/QR-token
// fields), never the EventStaff assignment-row shape (see schema.d.ts'
// getEventStaff comment). There is no name/station field on this resource
// at all — StaffCard must never fabricate one.
export function useEventStaff(eventId: string) {
  return $api.useQuery("get", "/api/events/{event_id}/staff", { params: { path: { event_id: eventId } } });
}

// Query-key prefix for GET /api/events/{event_id}/staff, scoped to a single
// event. Same verified [method, path, init] shape ATTENDEES_LIST_KEY
// documents (attendees/hooks.ts:49-67) — there's only one query-param shape
// for this path (no with_stats-style variant), so this is a plain exact-path
// prefix rather than a cross-shape one.
export function STAFF_KEY(eventId: string) {
  return ["get", "/api/events/{event_id}/staff", { params: { path: { event_id: eventId } } }] as const;
}

// A single user's zone assignments across every zone they've been granted
// (not scoped to one event) — StaffCard's per-card zones caption joins this
// against the event's plain zones list (attendees/hooks.ts' useEventZones)
// by zone_id to get display names, since StaffZoneAssignment carries ids
// only.
export function useUserZoneAssignments(userId: string) {
  return $api.useQuery("get", "/api/users/{user_id}/zones", { params: { path: { user_id: userId } } });
}

// Query-key for GET /api/users/{user_id}/zones, scoped to a single user.
export function USER_ZONES_KEY(userId: string) {
  return ["get", "/api/users/{user_id}/zones", { params: { path: { user_id: userId } } }] as const;
}
