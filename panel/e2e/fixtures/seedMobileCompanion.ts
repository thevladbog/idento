import { randomUUID } from "node:crypto";
import { request as playwrightRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { loginAdmin, loginWithCredentials, type E2ESession } from "./e2eAuth";
import { seedCheckinEvent, type SeedResult } from "./seedCheckinEvent";

const BACKEND_URL = "http://localhost:8008";

type SeedAttendee = {
  id: string;
  first_name: string;
  last_name: string;
  code: string;
};

type SeedUser = {
  id: string;
  email: string;
};

export type MobileSeed = SeedResult & {
  adminSession: E2ESession;
  staffSession: E2ESession;
  availableAttendee: { id: string; name: string };
  checkedInAttendee: { id: string; name: string };
  blockedAttendee: { id: string; name: string };
  staff: { id: string; email: string };
};

function displayName(attendee: SeedAttendee): string {
  return `${attendee.first_name} ${attendee.last_name}`;
}

function ensureOk(response: APIResponse, operation: string): void {
  if (!response.ok()) throw new Error(`${operation} failed with status ${response.status()}`);
}

async function createAttendee(
  api: APIRequestContext,
  eventId: string,
  firstName: string,
  lastName: string,
): Promise<SeedAttendee> {
  const response = await api.post(`/api/events/${eventId}/attendees`, {
    data: {
      first_name: firstName,
      last_name: lastName,
      code: `E2E-${randomUUID()}`,
    },
  });
  ensureOk(response, `mobile seed create ${firstName} attendee`);
  return (await response.json()) as SeedAttendee;
}

export async function seedMobileCompanion(): Promise<MobileSeed> {
  const base = await seedCheckinEvent();
  const adminSession = await loginAdmin();
  const api = await playwrightRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${adminSession.token}` },
  });

  try {
    const availableResponse = await api.get(`/api/events/${base.eventId}/attendees`, {
      params: { code: base.attendeeCode },
    });
    ensureOk(availableResponse, "mobile seed find available attendee");
    const availableRows = (await availableResponse.json()) as SeedAttendee[];
    const available = availableRows.find((attendee) => attendee.code === base.attendeeCode);
    if (!available) throw new Error("mobile seed attendee code did not match the requested attendee");

    const checkedIn = await createAttendee(api, base.eventId, "Grace", "Hopper");
    const blocked = await createAttendee(api, base.eventId, "Katherine", "Johnson");

    const checkinResponse = await api.post(`/api/events/${base.eventId}/checkin`, {
      data: { attendee_id: checkedIn.id, station_id: base.stationId },
    });
    ensureOk(checkinResponse, "mobile seed check in attendee");

    const blockResponse = await api.post(`/api/attendees/${blocked.id}/block`, {
      data: { reason: "E2E mobile acceptance" },
    });
    ensureOk(blockResponse, "mobile seed block attendee");

    const staffEmail = `e2e-staff-${randomUUID()}@example.test`;
    const staffPassword = `E2e!${randomUUID()}Aa`;
    const createStaffResponse = await api.post("/api/users", {
      data: { email: staffEmail, password: staffPassword, role: "staff" },
    });
    ensureOk(createStaffResponse, "mobile seed create staff user");
    const staff = (await createStaffResponse.json()) as SeedUser;

    const assignResponse = await api.post(`/api/events/${base.eventId}/staff`, {
      data: { user_id: staff.id },
    });
    ensureOk(assignResponse, "mobile seed assign staff user");

    const staffSession = await loginWithCredentials(staffEmail, staffPassword);

    return {
      ...base,
      adminSession,
      staffSession,
      availableAttendee: { id: available.id, name: displayName(available) },
      checkedInAttendee: { id: checkedIn.id, name: displayName(checkedIn) },
      blockedAttendee: { id: blocked.id, name: displayName(blocked) },
      staff: { id: staff.id, email: staff.email },
    };
  } finally {
    await api.dispose();
  }
}
