import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { AttendeeDrawer } from "./AttendeeDrawer";
import { useAttendeesPage } from "./hooks";
import { agentClient, AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { useEventReadiness } from "../events/hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Task 8 (P3.2): every AttendeeDrawer instance now ALSO mounts
// useAgentPrinters(true) (the reachability-gated Reprint button) and
// usePrintBadge's own useBadgeTemplate/useEventFontFaces calls -- all
// unconditional, regardless of whether any given test cares about
// printing. MSW's `onUnhandledRequest: "error"` (test/msw.ts) means EVERY
// test in this file needs these endpoints mocked, not just the reprint-
// specific describe block below.
class MockFontFace {
  family: string;
  constructor(family: string, _source: unknown, _descriptors?: { weight?: string; style?: string }) {
    this.family = family;
  }
  load(): Promise<MockFontFace> {
    return Promise.resolve(this);
  }
}
function stubFontFaceApi() {
  (globalThis as unknown as { FontFace: unknown }).FontFace = MockFontFace;
  Object.defineProperty(document, "fonts", { value: { add: () => {} }, configurable: true, writable: true });
}
function unstubFontFaceApi() {
  delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
  // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts`
  // stub; real jsdom has no `fonts` property to restore.
  delete document.fonts;
}

let templateResponse: { template: Record<string, unknown> | null; version: number } = { template: null, version: 0 };
// Disconnected by default (matches the OLD permanently-locked button's
// "generally not clickable" baseline for every test that doesn't care about
// printing) -- individual reprint tests flip this to true.
let agentHealthOk = false;
let printersResponse: Array<{ name: string; type: string }> = [];
let defaultPrinterResponse: { default: string | null } = { default: null };
let printCapture: { printer_name: string; zpl: string } | null = null;
let printHitCount = 0;
let printStatus = 200;
let printDelayMs = 0;
let markPrintedStatus = 200;
let markPrintedHitCount = 0;

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
let attendeeGetHitCount = 0;
let zoneAccessResponse: (typeof ZONE_ACCESS)[number][] = ZONE_ACCESS;
let zoneAccessStatus = 200;
let zoneHistoryResponse: unknown = ZONE_HISTORY;
let zoneHistoryStatus = 200;
let listHitCount = 0;

let patchAttendeeCount = 0;
let lastPatchAttendeeBody: unknown;
let patchAttendeeStatusOverride: number | null = null;

let deleteAttendeeCount = 0;
let lastDeletedAttendeeId: string | undefined;
let deleteAttendeeStatusOverride: number | null = null;

let addZoneAccessCount = 0;
let lastAddZoneAccessBody: unknown;

let removeZoneAccessCount = 0;
let lastRemovedZoneAccessId: string | undefined;

let readinessHitCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessHitCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
  http.get("http://api.test/api/attendees/:id", () => {
    attendeeGetHitCount += 1;
    if (attendeeStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: attendeeStatus });
    return HttpResponse.json(attendeeResponse);
  }),
  http.get("http://api.test/api/attendees/:attendeeId/zone-access", () => {
    if (zoneAccessStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: zoneAccessStatus });
    return HttpResponse.json(zoneAccessResponse);
  }),
  http.get("http://api.test/api/attendees/:attendeeId/zone-history", () => {
    if (zoneHistoryStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: zoneHistoryStatus });
    return HttpResponse.json(zoneHistoryResponse);
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(ZONES)),
  http.get("http://api.test/api/events/:eventId/attendees", () => {
    listHitCount += 1;
    return HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 });
  }),
  http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
    patchAttendeeCount += 1;
    lastPatchAttendeeBody = await request.json();
    if (patchAttendeeStatusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: patchAttendeeStatusOverride });
    }
    attendeeResponse = { ...(attendeeResponse as object), ...(lastPatchAttendeeBody as object) };
    return HttpResponse.json(attendeeResponse);
  }),
  http.delete("http://api.test/api/attendees/:id", ({ params }) => {
    deleteAttendeeCount += 1;
    lastDeletedAttendeeId = params.id as string;
    if (deleteAttendeeStatusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: deleteAttendeeStatusOverride });
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("http://api.test/api/attendees/:attendeeId/zone-access", async ({ request }) => {
    addZoneAccessCount += 1;
    const body = (await request.json()) as { zone_id: string; allowed: boolean };
    lastAddZoneAccessBody = body;
    const newRow = {
      id: `za-new-${addZoneAccessCount}`,
      attendee_id: "a1",
      zone_id: body.zone_id,
      allowed: body.allowed,
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    zoneAccessResponse = [...zoneAccessResponse, newRow];
    return HttpResponse.json(newRow, { status: 201 });
  }),
  http.delete("http://api.test/api/attendee-zone-access/:id", ({ params }) => {
    removeZoneAccessCount += 1;
    lastRemovedZoneAccessId = params.id as string;
    zoneAccessResponse = zoneAccessResponse.filter((row) => row.id !== params.id);
    return HttpResponse.json({ message: "deleted" });
  }),
  // Task 8 additions below -- badge-template/fonts/agent/mark-printed.
  http.get("http://api.test/api/events/:id/badge-template", () => HttpResponse.json(templateResponse)),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.post("http://api.test/api/attendees/:attendeeId/printed", () => {
    markPrintedHitCount += 1;
    if (markPrintedStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: markPrintedStatus });
    return HttpResponse.json({ printed_count: markPrintedHitCount });
  }),
  http.get("http://agent.test/health", () =>
    agentHealthOk ? new HttpResponse(null, { status: 200 }) : HttpResponse.error()),
  http.get("http://agent.test/printers", () => HttpResponse.json(printersResponse)),
  http.get("http://agent.test/printers/default", () => HttpResponse.json(defaultPrinterResponse)),
  http.post("http://agent.test/print", async ({ request }) => {
    printHitCount += 1;
    printCapture = (await request.json()) as { printer_name: string; zpl: string };
    if (printDelayMs) await delay(printDelayMs);
    if (printStatus !== 200) return new HttpResponse("printer offline", { status: printStatus });
    return HttpResponse.json({ status: "printed" });
  }),
);
void server;

// Task 8: the drawer's no-badge-template reprint message links to the badge
// editor route, which needs a router context to resolve. Same minimal
// single-route harness as WorkspaceRail.test.tsx (this suite exercises the
// drawer's own rendering, not routing — no need for a route tree matching
// the real app's shape).
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>
      </QueryClientProvider>,
    ),
  };
}

// Same ListObserver pattern as DangerZoneCard.test.tsx: keeps the attendees
// list query actively subscribed so `queryClient.invalidateQueries` on
// ATTENDEES_LIST_KEY actually triggers an observable refetch.
function AttendeesListObserver() {
  useAttendeesPage("evt-1", { page: 1 });
  return null;
}

// Same pattern for GET /api/events/:id/readiness (ReadinessObserver, as in
// AddAttendeeDialog.test.tsx): a genuinely subscribed useQuery consumer so
// READINESS_KEY invalidation produces an OBSERVABLE refetch
// (readinessHitCount above), not just an asserted invalidate call.
function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

// Same shape as ImportWizard.test.tsx's `createGate()`: a deterministic,
// manually-released promise for a delayed MSW handler to await, so a test
// can synchronize on the handler having settled (via the returned
// non-optional `resolve`, always called and always followed by a `waitFor`)
// instead of a fixed-duration sleep "long enough" for it to probably have
// finished.
function createGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Shared Task 8 reset, called from BOTH describe blocks' beforeEach (every
// test in this file mounts the reachability-gated Reprint button + its
// underlying usePrintBadge hook now, not just the reprint-specific tests).
function resetTask8State() {
  templateResponse = { template: null, version: 0 };
  agentHealthOk = false;
  printersResponse = [];
  defaultPrinterResponse = { default: null };
  printCapture = null;
  printHitCount = 0;
  printStatus = 200;
  printDelayMs = 0;
  markPrintedStatus = 200;
  markPrintedHitCount = 0;
  stubFontFaceApi();
}

describe("AttendeeDrawer", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    attendeeResponse = ADA;
    attendeeStatus = 200;
    attendeeGetHitCount = 0;
    zoneAccessResponse = ZONE_ACCESS;
    zoneAccessStatus = 200;
    zoneHistoryResponse = ZONE_HISTORY;
    zoneHistoryStatus = 200;
    listHitCount = 0;
    patchAttendeeCount = 0;
    lastPatchAttendeeBody = undefined;
    patchAttendeeStatusOverride = null;
    deleteAttendeeCount = 0;
    lastDeletedAttendeeId = undefined;
    deleteAttendeeStatusOverride = null;
    addZoneAccessCount = 0;
    lastAddZoneAccessBody = undefined;
    removeZoneAccessCount = 0;
    lastRemovedZoneAccessId = undefined;
    readinessHitCount = 0;
    resetTask8State();
  });

  afterEach(() => {
    unstubFontFaceApi();
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

  // Regression test: `zone_name` can come back as "" server-side (e.g. a
  // zone deleted after the checkin was recorded). Before this fix, the
  // entry line was built as a literal template `"HH:MM — " + zone_name`,
  // so an empty zone_name produced a dangling "10:15 — " row with nothing
  // after the separator — instead it must fall back to an i18n'd label.
  it("falls back to an i18n'd label instead of a dangling separator when an activity entry's zone_name is empty", async () => {
    zoneHistoryResponse = [historyEntry("h1", "2026-07-14T10:15:00Z", "")];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("10:15 — unknown zone")).toBeInTheDocument();
    // Proves the separator never dangles with nothing after it.
    expect(screen.queryByText("10:15 —")).not.toBeInTheDocument();
  });

  it("shows only the dashed '+ Zone' placeholder when the attendee has no allowed zone access", async () => {
    zoneAccessResponse = [];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("+ Zone")).toBeInTheDocument();
    expect(screen.queryByText("Main hall")).not.toBeInTheDocument();
  });

  // Regression test: the disabled "+ Zone" placeholder must render for an
  // EXPLICIT "we don't know yet" reason while zone-access/zones are still
  // loading — not by coincidence of `availableZones` computing empty because
  // both queries are `undefined` at that point. Proven by gating only the
  // zones fetch while leaving a genuinely available (ungranted) zone once it
  // resolves — if the disabled state were solely an artifact of an empty
  // `availableZones` array, the button would flip to the interactive
  // dropdown as soon as zone-access alone finished loading, before zones
  // themselves ever arrive.
  it("keeps the '+ Zone' add-affordance disabled while zones are still loading, not just when zero zones are truly available", async () => {
    const zonesGate = createGate();
    server.use(
      http.get("http://api.test/api/events/:eventId/zones", async () => {
        await zonesGate.promise;
        return HttpResponse.json(ZONES);
      }),
    );
    // Leaves VIP lounge (z2) ungranted, so once zones finish loading there
    // genuinely IS a zone available to add.
    zoneAccessResponse = [ZONE_ACCESS[0]];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    const addZoneButton = await screen.findByRole("button", { name: "+ Zone" });
    expect(addZoneButton).toBeDisabled();

    zonesGate.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());
  });

  it("shows a distinct i18n'd error message (not the empty state) when the zone-access fetch fails, and hides '+ Zone'", async () => {
    zoneAccessStatus = 500;
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("Couldn't load zone access.")).toBeInTheDocument();
    // Must not be mistaken for "no zone access" or for a still-resolvable state.
    expect(screen.queryByText("Main hall")).not.toBeInTheDocument();
    expect(screen.queryByText("VIP lounge")).not.toBeInTheDocument();
    // Offering to add MORE zones while we don't know current access is confusing — hidden on error.
    expect(screen.queryByRole("button", { name: "+ Zone" })).not.toBeInTheDocument();
  });

  it("shows a distinct i18n'd error message (not the empty state) when the zone-history fetch fails", async () => {
    zoneHistoryStatus = 500;
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("Couldn't load activity.")).toBeInTheDocument();
    // Must not be mistaken for "no activity yet".
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/10:15 — VIP lounge/)).not.toBeInTheDocument();
  });

  it("renders Edit details, Regenerate code…, and Delete… as enabled controls; Reprint badge is reachability-gated disabled with a title while the agent is unreachable (Task 8)", async () => {
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Edit details" })).toBeEnabled();
    // Reachability-gated idiom (spec §7.3), not the OLD permanent lock: the
    // button text no longer says "coming with the badge editor" — it's a
    // real feature now, just disabled because the fixture's default agent
    // state (resetTask8State) is disconnected.
    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeDisabled());
    expect(reprintButton).toHaveAttribute("title", "Can't reach the local print agent.");
    expect(screen.getByRole("button", { name: "Regenerate code…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete…" })).toBeEnabled();
    // Fixture ZONE_ACCESS already grants both real event zones (z1/z2), so
    // there's nothing left to add — the affordance stays visible but disabled.
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeDisabled());
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

describe("AttendeeDrawer — Task 9 mutations", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    attendeeResponse = ADA;
    attendeeStatus = 200;
    attendeeGetHitCount = 0;
    zoneAccessResponse = ZONE_ACCESS;
    zoneAccessStatus = 200;
    zoneHistoryResponse = ZONE_HISTORY;
    zoneHistoryStatus = 200;
    listHitCount = 0;
    patchAttendeeCount = 0;
    lastPatchAttendeeBody = undefined;
    patchAttendeeStatusOverride = null;
    deleteAttendeeCount = 0;
    lastDeletedAttendeeId = undefined;
    deleteAttendeeStatusOverride = null;
    addZoneAccessCount = 0;
    lastAddZoneAccessBody = undefined;
    removeZoneAccessCount = 0;
    lastRemovedZoneAccessId = undefined;
    readinessHitCount = 0;
    resetTask8State();
  });

  afterEach(() => {
    unstubFontFaceApi();
  });

  it("edit details PATCHes only the changed field", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "Senior Engineer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(lastPatchAttendeeBody).toEqual({ position: "Senior Engineer" });

    // Returns to the read view and invalidates both queries.
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeInTheDocument();
    await waitFor(() => expect(listHitCount).toBeGreaterThan(0));
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(1));
  });

  // Regression test: the PATCH-body dirty-check must compare the RAW form
  // value against the RAW baseline (matching `isDirty`'s own logic), not the
  // TRIMMED value against the raw baseline. A baseline imported with messy
  // whitespace (e.g. from a bad CSV) must not make an untouched field look
  // "changed" just because trimming it happens to differ from the untrimmed
  // baseline — only the field the user actually edited should appear in the
  // PATCH body.
  it("does not include an untouched field in the PATCH body even when its baseline has leading/trailing whitespace", async () => {
    attendeeResponse = { ...ADA, company: "  Acme Corp" };
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    // Only touch Position — Company is left exactly as loaded.
    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "Senior Engineer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    // Company must be entirely absent from the body — not present with its
    // silently-trimmed value — since the user never touched it.
    expect(lastPatchAttendeeBody).toEqual({ position: "Senior Engineer" });
    expect(lastPatchAttendeeBody).not.toHaveProperty("company");
  });

  // Regression test for the same stale-PATCH-response race GeneralCard.test.tsx
  // covers: `patchAttendee.reset()` on every keystroke only clears the
  // mutation observer's local state, it does NOT cancel the first, still
  // in-flight PATCH — that response must not overwrite a newer, still-unsaved
  // edit made while it was pending.
  it("does not let a stale PATCH response overwrite a newer, still-unsaved edit made while the first save was pending", async () => {
    // Same `createGate()` shape as ImportWizard.test.tsx's chunk gates: a
    // non-optional releaser (definite-assignment, not `| undefined`) that
    // the test MUST call and await settling via `waitFor`, rather than a
    // fixed-duration sleep "long enough" for the response to have probably
    // landed.
    const firstPatchGate = createGate();
    server.use(
      http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
        patchAttendeeCount += 1;
        lastPatchAttendeeBody = await request.json();
        await firstPatchGate.promise;
        return HttpResponse.json({ ...ADA, ...(lastPatchAttendeeBody as object) });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "First edit");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // A legitimate second edit while the first save is still pending —
    // `reset()` (fired by this edit) re-enables Save without cancelling the
    // in-flight request.
    await user.clear(positionInput);
    await user.type(positionInput, "Second edit");

    const attendeeGetHitCountBeforeRelease = attendeeGetHitCount;
    firstPatchGate.resolve();

    // The stale onSuccess still runs its unconditional cache invalidation
    // (see EditAttendeeForm.tsx's comment on that) even though the version
    // guard skips applying the response — waiting for that invalidation's
    // refetch to land against the always-subscribed attendee-detail query is
    // a deterministic signal that the stale onSuccess has fully executed,
    // rather than a fixed-duration sleep hoping it "probably" has.
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(attendeeGetHitCountBeforeRelease));

    expect(screen.getByLabelText("Position")).toHaveValue("Second edit");
    // Still in edit mode — a stale success must not have returned to the
    // read view out from under the newer, unsaved edit.
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  // Regression test: the outer Sheet must refuse to close (Escape/outside-
  // click) while EditAttendeeForm's PATCH is genuinely in flight — otherwise
  // the whole drawer unmounts mid-save and the user has no way to know
  // whether their edit actually persisted.
  it("does not let Escape close the drawer while an edit-mode save is pending, but allows it again once the save resolves", async () => {
    const editPatchGate = createGate();
    server.use(
      http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
        patchAttendeeCount += 1;
        lastPatchAttendeeBody = await request.json();
        await editPatchGate.promise;
        return HttpResponse.json({ ...ADA, ...(lastPatchAttendeeBody as object) });
      }),
    );

    const onClose = vi.fn();
    const user = userEvent.setup();
    // `open` is hardcoded `true` on AttendeeDrawer's own Sheet — in the real
    // app it's the PARENT unmounting AttendeeDrawer on `onClose` that
    // actually makes the dialog disappear (see AttendeesPage.tsx's
    // `?attendee=` handling). Rendered standalone here, so "did Escape close
    // it" is asserted via `onClose` call counts, not dialog presence.
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "Senior Engineer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    // Cancel is disabled too while the save is pending.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");
    // onClose must not have been called — Escape was a no-op while the save
    // is genuinely in flight, and the edit form must still be showing.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Position")).toHaveValue("Senior Engineer");

    editPatchGate.resolve();
    // Save resolved — back to the read view.
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeInTheDocument();

    // Now that nothing is busy, Escape dismisses the drawer normally.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("+ Zone opens a picker of ungranted zones, POSTs the right body on selection, and refetches zone access", async () => {
    // Leave VIP lounge (z2) ungranted so there's something to add.
    zoneAccessResponse = [ZONE_ACCESS[0]];
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    await waitFor(() => expect(addZoneAccessCount).toBe(1));
    expect(lastAddZoneAccessBody).toEqual({ zone_id: "z2", allowed: true });

    // Refetch of the zone-access query reflects the newly-granted zone.
    await waitFor(() => expect(screen.getByText("VIP lounge")).toBeInTheDocument());
  });

  it("removes a zone chip via DELETE using the zone-access row id (not the zone id), then refetches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove Main hall" }));

    await waitFor(() => expect(removeZoneAccessCount).toBe(1));
    // za1 is the zone-access ROW id for the Main hall (z1) grant — the
    // component must send that, never the zone id "z1" itself.
    expect(lastRemovedZoneAccessId).toBe("za1");

    await waitFor(() => expect(screen.queryByText("Main hall")).not.toBeInTheDocument());
  });

  // Fix (Codex, PR #65): a zone-access change can affect whether this
  // attendee still matches an active `zone` filter on the attendees table,
  // so both add and remove must also invalidate the attendees list query —
  // not just the drawer's own zone-access query.
  it("invalidates the attendees list (not just zone access) when a zone is added", async () => {
    zoneAccessResponse = [ZONE_ACCESS[0]];
    listHitCount = 0;
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
  });

  it("invalidates the attendees list (not just zone access) when a zone is removed", async () => {
    listHitCount = 0;
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove Main hall" }));

    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
  });

  // Fix (Codex, PR #65): addZoneAccess previously had no onError handling —
  // a failed POST just closed the dropdown with no explanation.
  it("shows an inline error when adding a zone fails, and clears it once a retry succeeds", async () => {
    zoneAccessResponse = [ZONE_ACCESS[0]];
    let shouldFail = true;
    server.use(
      http.post("http://api.test/api/attendees/:attendeeId/zone-access", async ({ request }) => {
        if (shouldFail) {
          return HttpResponse.json({ error: "boom" }, { status: 500 });
        }
        addZoneAccessCount += 1;
        lastAddZoneAccessBody = await request.json();
        return HttpResponse.json({ id: "za2", attendee_id: "a1", zone_id: "z2", allowed: true }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    expect(await screen.findByText("Couldn't add that zone. Try again.")).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    await waitFor(() => expect(addZoneAccessCount).toBe(1));
    await waitFor(() => expect(screen.queryByText("Couldn't add that zone. Try again.")).not.toBeInTheDocument());
  });

  // Regression test: `removeZoneAccess` is a SINGLE mutation instance shared
  // by every zone chip's remove button. Before this fix, each chip derived
  // its own "removing" state from that shared mutation's `.variables` —
  // which only ever reflects the MOST RECENTLY fired call. Removing chip A
  // then chip B (before A's DELETE resolves) overwrote `.variables` to B's
  // params, making chip A's button read as "not removing" (re-enabled)
  // while A's DELETE was still genuinely in flight — a double-click on A at
  // that point would fire a second DELETE for an already-being-deleted row,
  // which the backend correctly 404s on (DeleteAttendeeZoneAccess is not
  // idempotent). The fix tracks pending removal per-row in a `Set` instead.
  it("keeps a zone chip's own remove button disabled for its whole in-flight DELETE, even after a different chip's remove is clicked before it resolves", async () => {
    const releasers: Record<string, () => void> = {};
    const deleteCallCounts: Record<string, number> = {};
    server.use(
      http.delete("http://api.test/api/attendee-zone-access/:id", async ({ params }) => {
        const id = params.id as string;
        deleteCallCounts[id] = (deleteCallCounts[id] ?? 0) + 1;
        removeZoneAccessCount += 1;
        lastRemovedZoneAccessId = id;
        await new Promise<void>((resolve) => {
          releasers[id] = resolve;
        });
        zoneAccessResponse = zoneAccessResponse.filter((row) => row.id !== id);
        return HttpResponse.json({ message: "deleted" });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());
    expect(screen.getByText("VIP lounge")).toBeInTheDocument();

    const removeMainHall = screen.getByRole("button", { name: "Remove Main hall" });
    const removeVipLounge = screen.getByRole("button", { name: "Remove VIP lounge" });

    // Remove chip A (za1) — its DELETE hangs until released below.
    await user.click(removeMainHall);
    await waitFor(() => expect(deleteCallCounts.za1).toBe(1));
    expect(removeMainHall).toBeDisabled();

    // Before A's DELETE resolves, remove chip B (za2) — this is the moment
    // that overwrites the shared mutation's `.variables` to za2's params.
    await user.click(removeVipLounge);
    await waitFor(() => expect(deleteCallCounts.za2).toBe(1));

    // Both DELETEs are genuinely still in flight — both buttons must stay
    // disabled. Pre-fix, chip A's button would have re-enabled here.
    expect(removeMainHall).toBeDisabled();
    expect(removeVipLounge).toBeDisabled();

    releasers.za1?.();
    releasers.za2?.();

    await waitFor(() => expect(screen.queryByText("Main hall")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("VIP lounge")).not.toBeInTheDocument());

    // Exactly one DELETE per row — no duplicate fired for za1 while it was
    // already being removed.
    expect(deleteCallCounts.za1).toBe(1);
    expect(deleteCallCounts.za2).toBe(1);
  });

  it("regenerates the code via PATCH with a UUID-shaped code and invalidates both queries", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));

    await user.click(screen.getByRole("button", { name: "Regenerate code…" }));
    const dialog = await screen.findByRole("dialog", { name: "Regenerate code" });
    await user.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(lastPatchAttendeeBody).toMatchObject({
      code: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    });
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(1));
    // The confirm dialog itself closes on success — the drawer (also a
    // `role="dialog"` Sheet) stays open throughout, so this must check the
    // confirm dialog's own accessible name rather than "no dialog at all".
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Regenerate code" })).not.toBeInTheDocument());
  });

  // Regression test for the cancel-during-pending race (same class as
  // DangerZoneCard.test.tsx's equivalent): the PATCH is still in flight when
  // the user clicks Cancel. The late response must not surface an error or
  // otherwise react once the dialog session has moved on.
  it("does not surface an error if the regenerate confirm dialog is cancelled before a pending PATCH resolves", async () => {
    server.use(
      http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
        patchAttendeeCount += 1;
        lastPatchAttendeeBody = await request.json();
        await delay(50);
        return HttpResponse.json({ error: "server error" }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Regenerate code…" }));
    const dialog = await screen.findByRole("dialog", { name: "Regenerate code" });
    await user.click(within(dialog).getByRole("button", { name: "Regenerate" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Regenerate code" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(screen.queryByText("Couldn't save changes. Try again.")).not.toBeInTheDocument();
  });

  it("delete: DELETEs the attendee, invalidates the list AND readiness (the deletion changes the rail's attendees count), and closes the whole drawer", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <ReadinessObserver eventId="evt-1" />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(readinessHitCount).toBe(1));

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete attendee" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAttendeeCount).toBe(1));
    expect(lastDeletedAttendeeId).toBe("a1");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    // The genuinely subscribed readiness observer actually refetches —
    // not just an invalidateQueries call asserted in isolation.
    await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
  });

  it("keeps the delete confirm dialog open with an inline error when the delete fails", async () => {
    deleteAttendeeStatusOverride = 500;
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete attendee" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAttendeeCount).toBe(1));
    expect(await within(dialog).findByText("Couldn't save changes. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete attendee" })).toBe(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  // Regression test for the cancel-during-pending race, mirroring
  // DangerZoneCard.test.tsx's equivalent for event deletion.
  it("does not close the drawer or surface an error if the delete confirm dialog is cancelled before a pending DELETE resolves", async () => {
    const onClose = vi.fn();
    server.use(
      http.delete("http://api.test/api/attendees/:id", async ({ params }) => {
        deleteAttendeeCount += 1;
        lastDeletedAttendeeId = params.id as string;
        await delay(50);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete attendee" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete attendee" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(deleteAttendeeCount).toBe(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Couldn't save changes. Try again.")).not.toBeInTheDocument();
  });
});

describe("AttendeeDrawer — Task 8 reprint", () => {
  const TEMPLATE_DOC = {
    width_mm: 90,
    height_mm: 55,
    dpi: 300,
    elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
  };

  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    attendeeResponse = ADA;
    attendeeStatus = 200;
    attendeeGetHitCount = 0;
    zoneAccessResponse = ZONE_ACCESS;
    zoneAccessStatus = 200;
    zoneHistoryResponse = ZONE_HISTORY;
    zoneHistoryStatus = 200;
    listHitCount = 0;
    readinessHitCount = 0;
    resetTask8State();
    // Every reprint test in this block needs a real saved template — the
    // no-template case below overrides it back to null explicitly.
    templateResponse = { template: TEMPLATE_DOC, version: 1 };
  });

  afterEach(() => {
    unstubFontFaceApi();
  });

  it("names the agent's default printer in the confirm dialog (no <select>), sends on confirm, marks the attendee printed, and refetches the list + detail (pill data)", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);

    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    expect(within(dialog).getByText("Print Ada Lovelace's badge on Zebra_ZD421?")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    await waitFor(() => expect(printCapture).not.toBeNull());
    expect(printCapture?.printer_name).toBe("Zebra_ZD421");
    // Resolved `first_name` binding ("Ada"), not the element's literal
    // fallback text ("Guest") -- proves attendeeToPreviewData actually fed
    // the generator.
    expect(printCapture?.zpl).toContain("^FDAda^FS");
    await waitFor(() => expect(markPrintedHitCount).toBe(1));

    // Dialog closes and the drawer shows the transport-honest "sent" line.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument());
    expect(await screen.findByText("Sent to Zebra_ZD421")).toBeInTheDocument();

    // Pill data (list + detail) refetches via invalidation.
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(1));
  });

  it("shows an inline printer <select> (no default configured), preselects the first printer, and sends to whichever printer is chosen", async () => {
    agentHealthOk = true;
    printersResponse = [
      { name: "Zebra_ZD421", type: "system" },
      { name: "Network_Printer", type: "network" },
    ];
    defaultPrinterResponse = { default: null };
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);

    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    expect(within(dialog).getByText("Choose a printer to print Ada Lovelace's badge.")).toBeInTheDocument();
    const select = within(dialog).getByLabelText<HTMLSelectElement>("Printer");
    await waitFor(() => expect(select.value).toBe("Zebra_ZD421"));

    await user.selectOptions(select, "Network_Printer");
    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    await waitFor(() => expect(printCapture).not.toBeNull());
    expect(printCapture?.printer_name).toBe("Network_Printer");
  });

  // Review fix (Task 8, Minor): the agent's configured default can name a
  // printer that has since been unplugged/removed. Naming (and sending to)
  // a printer that's no longer in the live list would be dishonest — a
  // stale default must fall through to the inline-select path exactly as
  // if no default were configured, preselecting a printer that actually
  // exists.
  it("falls through to the inline printer <select> (not the stale name) when the configured default is no longer in the live printer list", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Unplugged_Old_Printer" };
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);

    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    // The choose-a-printer body + select, never the stale default's name.
    expect(within(dialog).getByText("Choose a printer to print Ada Lovelace's badge.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Unplugged_Old_Printer/)).not.toBeInTheDocument();
    const select = within(dialog).getByLabelText<HTMLSelectElement>("Printer");
    await waitFor(() => expect(select.value).toBe("Zebra_ZD421"));

    await user.click(within(dialog).getByRole("button", { name: "Print" }));
    await waitFor(() => expect(printCapture).not.toBeNull());
    expect(printCapture?.printer_name).toBe("Zebra_ZD421");
  });

  it("shows an honest no-template message linking the badge editor, and never calls the agent, when the event has no saved template", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    templateResponse = { template: null, version: 0 };
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    expect(await within(dialog).findByText(/doesn.t have a badge template yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open the badge editor" })).toHaveAttribute(
      "href",
      "/events/evt-1/badge",
    );
    expect(printCapture).toBeNull();
    // Stays open on this error — same "keeps the confirm dialog open with an
    // inline error" idiom as the regenerate/delete dialogs.
    expect(screen.getByRole("dialog", { name: "Reprint badge" })).toBe(dialog);
  });

  // PR #74 review round Fix 8: the template references a customFont family
  // this event has no matching uploaded font for (this file's fonts
  // endpoint always returns `[]` — see line ~196 above) — the honest,
  // typed MissingFontError must block BEFORE any agent call, surfacing a
  // named-family message, never a silent wrong-font send.
  it("shows an honest missing-font message and never calls the agent when the template references a customFont with no matching uploaded font", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    templateResponse = {
      template: {
        width_mm: 90,
        height_mm: 55,
        dpi: 300,
        elements: [
          {
            id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest",
            customFont: "Brand Sans",
          },
        ],
      },
      version: 1,
    };
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    expect(await within(dialog).findByText(/Font Brand Sans is missing/)).toBeInTheDocument();
    expect(printCapture).toBeNull();
    expect(printHitCount).toBe(0);
    expect(markPrintedHitCount).toBe(0);
    // Stays open on this error — same idiom as the no-template case above.
    expect(screen.getByRole("dialog", { name: "Reprint badge" })).toBe(dialog);
  });

  it("shows a soft, non-destructive warning (not the harsh failure copy) when mark-printed fails after a successful send", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    markPrintedStatus = 500;
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    await waitFor(() => expect(printCapture).not.toBeNull());
    // The send genuinely happened -- dialog closes exactly like the happy
    // path, never treated as a full failure.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument());
    // Exactly one send -- the downstream mark-printed failure never retries
    // (or repeats) it.
    expect(printHitCount).toBe(1);
    expect(
      await screen.findByText("Sent to Zebra_ZD421, but the printed count couldn't be updated."),
    ).toBeInTheDocument();
  });

  it("disables the confirm button while a print is in flight, and the dialog closes once it resolves", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    printDelayMs = 40;
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    const confirmButton = within(dialog).getByRole("button", { name: "Print" });
    await user.click(confirmButton);

    await waitFor(() => expect(confirmButton).toBeDisabled());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument());
  });

  // Follow-up batch item 4: while the send is in flight, every dismiss path
  // is inert (Fix 2's mid-print lock) — without an explanation the disabled
  // Cancel reads as a broken button, and an operator might assume closing
  // WOULD have stopped the print. The hint states the transport-ack truth:
  // a send can't be recalled; a badge already handed to the agent still
  // prints.
  it("explains, while the send is in flight, that it can't be cancelled and an already-sent badge will still print", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    printDelayMs = 40;
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    // Not shown before confirming — nothing is in flight yet.
    expect(
      within(dialog).queryByText("Sending can't be cancelled — a badge already sent to the printer will still print."),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Print" }));
    expect(
      await within(dialog).findByText(
        "Sending can't be cancelled — a badge already sent to the printer will still print.",
      ),
    ).toBeInTheDocument();

    // The happy path closes the dialog once the send resolves — the hint
    // goes with it.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument());
  });

  // PR #74 review round Fix 2: cancel-during-pending is no longer a race to
  // win — Cancel (and every other dismiss path) is now INERT while printing,
  // matching TestPrintDialog's convention. A cancel attempt made DURING the
  // print must be a flat no-op (dialog stays open, print keeps running); the
  // outcome (here, a genuine send failure) must render in the still-open
  // dialog; and only THEN does Cancel actually work.
  it("ignores a Cancel click made during a pending print — the dialog stays open, shows the outcome, and only then can be closed", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    printStatus = 500;
    printDelayMs = 50;
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    // The Cancel click lands WHILE the (delayed) print is still in flight —
    // must be entirely ignored: dialog stays open, no early close.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Reprint badge" })).toBe(dialog);

    // The send genuinely fails (agent-level 500) once the delay elapses —
    // the dialog is STILL open (never dismissed above) and now shows the
    // honest failure copy, never a silently-swallowed error.
    expect(await within(dialog).findByText(/printer offline/)).toBeInTheDocument();
    expect(printCapture).not.toBeNull();

    // Printing has resolved (failed) — Cancel is live again, and now closes
    // the dialog for real.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument(),
    );
    // The OUTER Reprint button is not left stranded disabled.
    expect(screen.getByRole("button", { name: "Reprint badge" })).toBeEnabled();
  });

  // Follow-up batch item 2: a timed-out send is NOT a proven failure — the
  // abort only cancelled the client's wait; the agent may have received the
  // job, so the badge can still emerge. The generic branch's verbatim
  // `error.message` would leak the client-authored (non-i18n) English
  // message AND read like a plain failure, inviting a double print — the
  // typed error maps to dedicated honest copy instead.
  it("shows honest may-still-print timeout copy (not the raw error message) when the send times out", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    const printSpy = vi
      .spyOn(agentClient, "print")
      .mockRejectedValue(new AgentPrintTimeoutError(30_000));
    try {
      const user = userEvent.setup();
      renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
      await screen.findByText("Ada Lovelace");

      const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
      await waitFor(() => expect(reprintButton).toBeEnabled());
      await user.click(reprintButton);
      const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      expect(
        await within(dialog).findByText(
          "The print agent didn't respond. The badge may still print — check the printer before retrying.",
        ),
      ).toBeInTheDocument();
      // Never the raw client-authored message, and never a "sent" claim.
      expect(within(dialog).queryByText(/produced no response/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Sent to/)).not.toBeInTheDocument();
      // An unconfirmed send must never bump the printed counter.
      expect(markPrintedHitCount).toBe(0);
    } finally {
      printSpy.mockRestore();
    }
  });

  // Distinct from the mark-printed-failure test above: here the AGENT
  // itself rejects (the send never happened at all), so this must show the
  // full failure copy — the agent's own verbatim error text (same
  // "error instanceof Error ? error.message : fallback" idiom TestPrintDialog
  // uses) — never the softened "sent, but..." warning, and never a "printed"
  // claim.
  it("shows the agent's own error text and keeps the dialog open when the send itself fails (not a mark-printed failure)", async () => {
    agentHealthOk = true;
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultPrinterResponse = { default: "Zebra_ZD421" };
    printStatus = 404;
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    const reprintButton = await screen.findByRole("button", { name: "Reprint badge" });
    await waitFor(() => expect(reprintButton).toBeEnabled());
    await user.click(reprintButton);
    const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
    await user.click(within(dialog).getByRole("button", { name: "Print" }));

    expect(await within(dialog).findByText(/printer offline/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reprint badge" })).toBe(dialog);
    expect(markPrintedHitCount).toBe(0);
    expect(screen.queryByText(/^Sent to/)).not.toBeInTheDocument();
  });
});
