// Mirrors backend/openapi.yaml's Attendee/CheckinOutcome/StationCheckinResponse/
// CheckinStation/CheckinActionRow schemas verbatim (field names/nullability).
export interface Attendee {
  id: string;
  event_id: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  position: string;
  code: string;
  checkin_status: boolean;
  checked_in_at: string | null;
  printed_count: number;
  blocked: boolean;
  block_reason: string | null;
  custom_fields?: Record<string, unknown>;
}

// "not_found" is deliberately absent here -- it's a client-side outcome
// (verdict.ts's CheckinFlowOutcome), never returned by POST /checkin.
export type CheckinOutcome = "checked_in" | "already_checked_in" | "blocked";

export interface CheckinInfo {
  at: string;
  by_email: string;
  point_name: string | null;
}

export interface StationCheckinResponse {
  outcome: CheckinOutcome;
  attendee: Attendee;
  checkin: CheckinInfo | null;
}

export interface CheckinStation {
  id: string;
  event_id: string;
  name: string;
  zone_id: string | null;
  last_seen_at: string;
  created_at: string;
}

export interface CheckinActionAttendee {
  id: string;
  first_name: string;
  last_name: string;
  code: string;
}

export interface CheckinActionRow {
  id: string;
  action: "checkin" | "undo" | "reprint";
  station_id: string | null;
  created_at: string;
  attendee: CheckinActionAttendee;
}
