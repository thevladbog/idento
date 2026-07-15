import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { AttendeeDrawer } from "./AttendeeDrawer";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

const ADA = {
  id: "a1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "PD-0107",
  checkin_status: true,
  checked_in_at: "2026-07-14T09:12:00Z",
  checked_in_point_name: "Entrance A",
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const ZONES = [
  { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: true, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "z2", event_id: "evt-1", name: "VIP lounge", zone_type: "general", order_index: 1, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
];

const ZONE_ACCESS = [
  { id: "za1", attendee_id: "a1", zone_id: "z1", allowed: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "za2", attendee_id: "a1", zone_id: "z2", allowed: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "za3", attendee_id: "a1", zone_id: "z-unknown", allowed: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "za4", attendee_id: "a1", zone_id: "z1", allowed: false, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
];

function historyEntry(id: string, isoTime: string, zoneName: string) {
  return {
    checkin: { id, attendee_id: "a1", zone_id: "z1", checked_in_at: isoTime, event_day: "2026-07-14T00:00:00Z" },
    zone_name: zoneName,
    zone_type: "general",
  };
}

// Deliberately most-recent-first, and zone_name is NOT alphabetically
// sorted the same way — proves the component renders API order verbatim
// rather than re-sorting by time or by name.
const ZONE_HISTORY = [
  historyEntry("h1", "2026-07-14T10:15:00Z", "VIP lounge"),
  // Deliberately NOT "Entrance A" (the fixed attendee's checked_in_point_name)
  // — a collision there would let a bug in the status-pill/activity-row
  // separation slip past these tests undetected.
  historyEntry("h2", "2026-07-14T09:12:00Z", "Front desk"),
  historyEntry("h3", "2026-07-14T09:10:00Z", "Main hall"),
  historyEntry("h4", "2026-07-14T09:05:00Z", "Loading dock"),
  historyEntry("h5", "2026-07-14T09:00:00Z", "Registration"),
];

let attendeeResponse: unknown = ADA;
let attendeeStatus = 200;
let zoneAccessResponse: unknown = ZONE_ACCESS;
let zoneHistoryResponse: unknown = ZONE_HISTORY;

const server = startMswServer(
  http.get("http://api.test/api/attendees/:id", () => {
    if (attendeeStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: attendeeStatus });
    return HttpResponse.json(attendeeResponse);
  }),
  http.get("http://api.test/api/attendees/:attendeeId/zone-access", () => HttpResponse.json(zoneAccessResponse)),
  http.get("http://api.test/api/attendees/:attendeeId/zone-history", () => HttpResponse.json(zoneHistoryResponse)),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(ZONES)),
);
void server;

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

describe("AttendeeDrawer", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    attendeeResponse = ADA;
    attendeeStatus = 200;
    zoneAccessResponse = ZONE_ACCESS;
    zoneHistoryResponse = ZONE_HISTORY;
  });

  it("shows a single whole-body skeleton while the attendee is loading, not the real sections", async () => {
    // Never resolves within this test — asserts the pre-data render only.
    server.use(http.get("http://api.test/api/attendees/:id", () => new Promise(() => {})));
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByTestId("attendee-drawer-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("shows an i18n'd error message and nothing else when the attendee fetch fails", async () => {
    attendeeStatus = 500;
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Couldn't load this attendee.")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.queryByTestId("attendee-drawer-skeleton")).not.toBeInTheDocument();
  });

  it("renders the header, checked-in pill with time and point, resolved zone chips, and up to 3 activity rows in API order", async () => {
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument(); // initials avatar
    expect(screen.getByTestId("attendee-drawer-subline")).toHaveTextContent("Analytical Engines · PD-0107");

    // WCAG 1.4.1: icon + text + color together for the checked-in pill.
    expect(screen.getByText("Checked in · 09:12 · Entrance A")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());
    expect(screen.getByText("VIP lounge")).toBeInTheDocument();
    // allowed=false row for z1 must not add a second chip beyond the one
    // allowed=true chip already resolved for z1.
    expect(screen.getAllByText("Main hall")).toHaveLength(1);
    // Unresolvable zone id falls back gracefully instead of crashing.
    expect(screen.getByText("z-unknow")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("10:15 — VIP lounge")).toBeInTheDocument());
    expect(screen.getByText("09:12 — Front desk")).toBeInTheDocument();
    expect(screen.getByText("09:10 — Main hall")).toBeInTheDocument();
    expect(screen.queryByText("09:05 — Loading dock")).not.toBeInTheDocument();
    expect(screen.queryByText("09:00 — Registration")).not.toBeInTheDocument();
  });

  it("omits the company separator gracefully when company is blank", async () => {
    attendeeResponse = { ...ADA, company: "" };
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("PD-0107")).toBeInTheDocument();
    expect(screen.queryByText(/·\s*PD-0107/)).not.toBeInTheDocument();
  });

  it("omits the checked-in point segment gracefully when checked_in_point_name is null", async () => {
    attendeeResponse = { ...ADA, checked_in_point_name: null };
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Checked in · 09:12")).toBeInTheDocument();
    expect(screen.queryByText(/Entrance A/)).not.toBeInTheDocument();
  });

  it("shows a muted 'Not checked in' pill (icon + text) when checkin_status is false", async () => {
    attendeeResponse = { ...ADA, checkin_status: false, checked_in_at: null, checked_in_point_name: null };
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Not checked in")).toBeInTheDocument();
    expect(screen.queryByText(/Checked in/)).not.toBeInTheDocument();
  });

  it("shows 'No activity yet' when the attendee has no movement history", async () => {
    zoneHistoryResponse = [];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("shows only the dashed '+ Zone' placeholder when the attendee has no allowed zone access", async () => {
    zoneAccessResponse = [];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("+ Zone")).toBeInTheDocument();
    expect(screen.queryByText("Main hall")).not.toBeInTheDocument();
  });

  it("renders Edit details, Reprint badge, + Zone, Regenerate code…, and Delete… as disabled — Task 9 wires them", async () => {
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Edit details" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reprint badge — coming with the badge editor" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Regenerate code…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete…" })).toBeDisabled();
  });

  it("calls onClose when the built-in Sheet close affordance is used", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has an accessible dialog title even while the attendee is still loading", async () => {
    server.use(http.get("http://api.test/api/attendees/:id", () => new Promise(() => {})));
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // sr-only fallback title, present before the real attendee name loads.
    expect(within(screen.getByRole("dialog")).getByText("Attendee details")).toBeInTheDocument();
  });
});
