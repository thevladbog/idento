export interface Event {
  id: string;
  tenant_id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  location?: string;
  field_schema?: string[];
  custom_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

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
  checked_in_at?: string;
  checked_in_by?: string;
  checked_in_by_email?: string;
  printed_count: number;
  blocked: boolean;
  block_reason?: string;
  custom_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  settings?: Record<string, unknown>;
  logo_url?: string;
  website?: string;
  contact_email?: string;
  created_at: string;
  updated_at: string;
  role?: string; // User's role in this tenant
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  qr_token?: string;
  qr_token_created_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EventZone {
  id: string;
  event_id: string;
  name: string;
  zone_type: string;
  order_index: number;
  open_time?: string;
  close_time?: string;
  is_registration_zone: boolean;
  requires_registration: boolean;
  is_active: boolean;
  settings?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EventZoneWithStats {
  zone: EventZone;
  total_checkins: number;
  today_checkins: number;
  assigned_staff: number;
  access_rules_count: number;
}

export interface ZoneAccessRule {
  id: string;
  zone_id: string;
  category: string;
  allowed: boolean;
  created_at: string;
}

export interface StaffZoneAssignment {
  id: string;
  user_id: string;
  zone_id: string;
  assigned_at: string;
  assigned_by?: string;
}

export interface MovementHistoryEntry {
  checkin: {
    id: string;
    attendee_id: string;
    zone_id: string;
    checked_in_at: string;
    checked_in_by?: string;
    event_day: string;
    metadata?: Record<string, unknown>;
  };
  zone_name: string;
  zone_type: string;
}

export interface ZoneCheckin {
  id: string;
  attendee_id: string;
  zone_id: string;
  checked_in_at: string;
  checked_in_by?: string;
  event_day: string;
  metadata?: Record<string, unknown>;
}

export interface AttendeeZoneAccess {
  id: string;
  attendee_id: string;
  zone_id: string;
  allowed: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ZoneQRData {
  type: 'zone';
  zone_id: string;
  event_id: string;
}
