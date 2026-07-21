import { request as playwrightRequest } from "@playwright/test";

const BACKEND_URL = "http://localhost:8008";
const ADMIN_EMAIL = "admin@test.com";
const ADMIN_PASSWORD = "password";

export type SeedResult = {
  token: string;
  eventId: string;
  stationId: string;
  attendeeCode: string;
  unknownCode: string;
};

// Seeds one fresh, fully check-in-ready event via the real backend API (no
// UI interaction) — logs in as the fixed seeded admin (backend runs in its
// default onprem mode, so there is no self-serve /auth/register path
// available), then creates just enough real data to satisfy
// GET /api/events/{id}/readiness's ready=true (attendees>0, badge has a
// non-empty elements array, staff>0 — backend/internal/handler/readiness.go).
// print_on_checkin is turned off so a `checked_in` verdict never attempts a
// network call to a print agent this suite doesn't run.
export async function seedCheckinEvent(): Promise<SeedResult> {
  const anon = await playwrightRequest.newContext({ baseURL: BACKEND_URL });

  const loginRes = await anon.post("/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!loginRes.ok()) {
    throw new Error(`seed login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const login = await loginRes.json();
  const token: string = login.token;
  const adminUserId: string = login.user.id;
  await anon.dispose();

  const api = await playwrightRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });

  const eventRes = await api.post("/api/events", {
    data: { name: `E2E Check-in ${Date.now()}` },
  });
  if (!eventRes.ok()) {
    throw new Error(`seed create event failed: ${eventRes.status()} ${await eventRes.text()}`);
  }
  const event = await eventRes.json();
  const eventId: string = event.id;

  const attendeeCode = `E2E-${Date.now()}-01`;
  const unknownCode = `E2E-${Date.now()}-NEVER-CREATED`;
  const attendeeRes = await api.post(`/api/events/${eventId}/attendees`, {
    data: { first_name: "Ada", last_name: "Lovelace", code: attendeeCode },
  });
  if (!attendeeRes.ok()) {
    throw new Error(`seed create attendee failed: ${attendeeRes.status()} ${await attendeeRes.text()}`);
  }

  const badgeRes = await api.put(`/api/events/${eventId}/badge-template`, {
    data: {
      template: {
        width_mm: 90,
        height_mm: 55,
        dpi: 203,
        elements: [{ id: "el1", type: "text", x: 10, y: 10, text: "E2E Badge" }],
      },
      version: 0,
    },
  });
  if (!badgeRes.ok()) {
    throw new Error(`seed badge template failed: ${badgeRes.status()} ${await badgeRes.text()}`);
  }

  const staffRes = await api.post(`/api/events/${eventId}/staff`, {
    data: { user_id: adminUserId },
  });
  if (!staffRes.ok()) {
    throw new Error(`seed assign staff failed: ${staffRes.status()} ${await staffRes.text()}`);
  }

  const readinessRes = await api.get(`/api/events/${eventId}/readiness`);
  const readiness = await readinessRes.json();
  if (readiness.ready !== true) {
    throw new Error(`seed event not ready: ${JSON.stringify(readiness)}`);
  }

  const settingsRes = await api.put(`/api/events/${eventId}/checkin-settings`, {
    data: {
      settings: {
        print_on_checkin: false,
        verdict_auto_dismiss_sec: 4,
        scan_input: "wedge",
        manual_search_enabled: true,
      },
    },
  });
  if (!settingsRes.ok()) {
    throw new Error(`seed checkin-settings failed: ${settingsRes.status()} ${await settingsRes.text()}`);
  }

  const stationRes = await api.post(`/api/events/${eventId}/checkin-stations`, {
    data: { name: "E2E Station" },
  });
  if (!stationRes.ok()) {
    throw new Error(`seed register station failed: ${stationRes.status()} ${await stationRes.text()}`);
  }
  const station = await stationRes.json();
  const stationId: string = station.station.id;

  await api.dispose();

  return { token, eventId, stationId, attendeeCode, unknownCode };
}
