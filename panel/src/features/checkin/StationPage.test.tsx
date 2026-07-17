// P4.1 Task 8 -- StationPage tests.
//
// The FIRST describe block below is the highest-risk proof for this task
// (per the brief): app/router.tsx registers `eventCheckinRoute` as a
// TOP-LEVEL protected route, a SIBLING of `eventWorkspaceRoute` (both
// children of `protectedLayoutRoute`), specifically so
// `/events/$eventId/checkin` renders StationPage WITHOUT the workspace
// rail shell (WorkspaceRail/EventWorkspaceLayout). Both registrations
// (sibling vs. "child of the workspace route with a relative path")
// resolve to the IDENTICAL final URL, so only the RENDERED OUTPUT (not the
// matched path string) can tell a correct sibling registration apart from
// an accidental nested one -- this file proves it two ways: (1) a routed
// harness shaped exactly like app/router.tsx's real registration renders
// StationPage's content with none of the workspace shell's nav markers
// present, and (2) a deliberately-misregistered harness (checkin route
// nested as a CHILD of the workspace route) demonstrates the SAME
// assertion would fail if the registration were wrong -- proof the
// technique actually discriminates, not a vacuously-passing check.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { verdictClasses } from "@idento/ui";
import { StationPage } from "./StationPage";
import { checkinStationBeforeLoad, validateCheckinStationSearch } from "./searchParams";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type Attendee = components["schemas"]["Attendee"];
type CheckinOutcome = "checked_in" | "already_checked_in" | "blocked";

// Distinguishing marker text for the workspace rail shell's own nav items
// (WorkspaceRail.tsx's real English copy: Overview/Attendees/Zones/Staff/
// Badge) -- if the checkin route were wrongly nested under the workspace
// route, these would render alongside StationPage's own content.
function WorkspaceShellStub() {
  return (
    <div>
      <nav>
        <span>Overview</span>
        <span>Attendees</span>
        <span>Zones</span>
        <span>Staff</span>
        <span>Badge</span>
      </nav>
      <Outlet />
    </div>
  );
}

// Mirrors app/router.tsx's REAL shape: an app-layout id route
// ("_app", standing in for protectedLayoutRoute) with the workspace route
// AND the checkin route registered as SIBLING children -- exactly the
// registration this task adds to the real router.
function buildCorrectRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: WorkspaceShellStub,
  });
  const checkinRoute = createRoute({
    getParentRoute: () => appLayoutRoute, // sibling of workspaceRoute -- the fix under test.
    path: "/events/$eventId/checkin",
    validateSearch: validateCheckinStationSearch,
    beforeLoad: checkinStationBeforeLoad,
    component: StationPage,
  });
  const launchRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId/checkin/launch",
    component: () => <div>launch ceremony stub</div>,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute, checkinRoute, launchRoute])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

// Reproduces the bug the sibling registration above avoids: the checkin
// route nested as a CHILD of the workspace route (relative path
// "/checkin") resolves to the exact same final URL
// ("/events/$eventId/checkin") but renders wrapped inside the workspace
// shell's own <Outlet/>.
function buildMisregisteredRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: WorkspaceShellStub,
  });
  const nestedCheckinRoute = createRoute({
    getParentRoute: () => workspaceRoute, // the mistake: a CHILD, not a sibling.
    path: "/checkin",
    component: () => <div data-testid="dummy-checkin-page">dummy</div>,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([nestedCheckinRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderWithRouter(router: ReturnType<typeof buildCorrectRouter> | ReturnType<typeof buildMisregisteredRouter>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton -- same rationale as
          AttendeesPage.test.tsx / EventWorkspaceLayout.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

function renderCorrectAt(path: string) {
  return renderWithRouter(buildCorrectRouter(path));
}

const EVENT = {
  id: "evt-1",
  tenant_id: "t1",
  name: "Partner Day — Autumn",
  start_date: "2026-09-03T00:00:00.000Z",
  created_at: "",
  updated_at: "",
};

const STATIONS = [
  { id: "st-1", event_id: "evt-1", name: "Main Door", last_seen_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
];

const ATTENDEE: Attendee = {
  id: "att-1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "CODE1",
  checkin_status: false,
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

let checkinOutcome: CheckinOutcome = "checked_in";
let checkinHitCount = 0;
let settingsOverride = {
  print_on_checkin: false,
  verdict_auto_dismiss_sec: 30,
  scan_input: "wedge" as const,
  manual_search_enabled: true,
};

const server = startMswServer(
  http.get("http://api.test/api/events/:id", () => HttpResponse.json(EVENT)),
  http.get("http://api.test/api/events/:eventId/checkin-stations", () => HttpResponse.json({ stations: STATIONS })),
  http.get("http://api.test/api/events/:id/checkin-settings", () => HttpResponse.json({ settings: settingsOverride })),
  http.get("http://api.test/api/events/:eventId/attendees", ({ request }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    // The wedge-scan lookup (useCheckinFlow.submitCode) always sends `code`
    // (never `page`/`per_page`) and expects the legacy bare-array shape.
    // The manual search box (ScanInput -> useAttendeesPage, Task 7) always
    // sends `page`/`per_page`/`search` and expects the `{attendees, total,
    // page, per_page}` envelope -- same two-shape split ScanInput.test.tsx's
    // own handler documents.
    if (code !== null) {
      return HttpResponse.json(code === ATTENDEE.code ? [ATTENDEE] : []);
    }
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const haystack = `${ATTENDEE.first_name} ${ATTENDEE.last_name} ${ATTENDEE.email} ${ATTENDEE.code}`.toLowerCase();
    const matches = search && haystack.includes(search) ? [ATTENDEE] : [];
    return HttpResponse.json({ attendees: matches, total: matches.length, page: 1, per_page: 8 });
  }),
  http.post("http://api.test/api/events/:eventId/checkin", async ({ request }) => {
    checkinHitCount += 1;
    const body = (await request.json()) as { attendee_id: string; station_id?: string | null };
    const attendee: Attendee = {
      ...ATTENDEE,
      id: body.attendee_id,
      checkin_status: checkinOutcome !== "blocked",
      blocked: checkinOutcome === "blocked",
    };
    const checkin =
      checkinOutcome === "blocked"
        ? null
        : { at: "2026-01-01T12:34:00Z", by_email: "staff@example.com", point_name: "Main Door" };
    return HttpResponse.json({ outcome: checkinOutcome, attendee, checkin });
  }),
  // Task 9's RecentScansRail mounts unconditionally alongside the verdict
  // panel -- its own feed query, plus usePrintBadge's own
  // useBadgeTemplate/useEventFontFaces calls (reprint's print pipeline),
  // need mocking here too, same as every OTHER surface that mounts
  // usePrintBadge (AttendeeDrawer.test.tsx's own top-of-file comment).
  http.get("http://api.test/api/events/:eventId/checkin-actions", () => HttpResponse.json({ actions: [] })),
  http.get("http://api.test/api/events/:id/badge-template", () => HttpResponse.json({ template: null, version: 0 })),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  // Task 12's useHeartbeat mounts unconditionally alongside every other hook
  // here and fires an immediate POST on mount -- mocked like every other
  // endpoint this page hits (this suite's own top-of-block precedent) rather
  // than left to MSW's onUnhandledRequest:"error".
  http.post("http://api.test/api/events/:eventId/checkin-stations/:id/heartbeat", () => new HttpResponse(null, { status: 204 })),
  http.get("http://agent.test/health", () => new HttpResponse(null, { status: 200 })),
  http.get("http://agent.test/printers", () => HttpResponse.json([])),
  http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: null })),
);
void server;

describe("StationPage routing -- sibling registration proof", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
  });

  it("renders StationPage's own content with NONE of the workspace shell's nav markers, when registered as a top-level sibling of the workspace route (app/router.tsx's real shape)", async () => {
    renderCorrectAt("/events/evt-1/checkin?station=st-1");

    expect(await screen.findByTestId("checkin-station-page")).toBeInTheDocument();
    expect(await screen.findByTestId("checkin-recent-scans-rail")).toBeInTheDocument();

    // None of the workspace shell's own distinguishing nav text is
    // present -- if the checkin route had been (incorrectly) nested as a
    // CHILD of the workspace route instead of registered as its sibling,
    // these would render too (see the misregistration reproduction below).
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendees")).not.toBeInTheDocument();
    expect(screen.queryByText("Zones")).not.toBeInTheDocument();
    expect(screen.queryByText("Staff")).not.toBeInTheDocument();
    expect(screen.queryByText("Badge")).not.toBeInTheDocument();
  });

  it("sanity check: the SAME workspace-shell-marker assertion WOULD fail if the checkin route were (incorrectly) nested as a child of the workspace route -- proof the technique above actually discriminates", async () => {
    const router = buildMisregisteredRouter("/events/evt-1/checkin");
    renderWithRouter(router);

    expect(await screen.findByTestId("dummy-checkin-page")).toBeInTheDocument();
    // The workspace shell's nav leaks through here -- this is the exact
    // bug the sibling registration in app/router.tsx avoids.
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Badge")).toBeInTheDocument();
  });

  it("redirects to the launch ceremony when ?station= is missing (checkinStationBeforeLoad, shared with app/router.tsx's real route)", async () => {
    const router = renderCorrectAt("/events/evt-1/checkin");

    await waitFor(() => expect(router.state.location.pathname).toBe("/events/evt-1/checkin/launch"));
    expect(await screen.findByText("launch ceremony stub")).toBeInTheDocument();
  });
});

describe("StationPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    checkinOutcome = "checked_in";
    checkinHitCount = 0;
    settingsOverride = {
      print_on_checkin: false,
      verdict_auto_dismiss_sec: 30,
      scan_input: "wedge",
      manual_search_enabled: true,
    };
  });

  it("renders the split layout: top bar (event name, station name, Exit), the idle verdict panel, scan input, and the rail placeholder", async () => {
    renderCorrectAt("/events/evt-1/checkin?station=st-1");

    expect(await screen.findByRole("heading", { name: "Partner Day — Autumn" })).toBeInTheDocument();
    expect(await screen.findByText("Main Door")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Exit/ })).toHaveAttribute("href", "/events/evt-1");
    expect(screen.getByTestId("checkin-verdict-idle")).toBeInTheDocument();
    expect(screen.getByLabelText("Badge scanner input")).toBeInTheDocument();
    expect(await screen.findByTestId("checkin-recent-scans-rail")).toBeInTheDocument();
  });

  // Final cross-task review finding -- `settings.manual_search_enabled`
  // previously had no consumer at the station at all: toggling "Allow
  // manual search" off in the launch ceremony had zero effect, since
  // StationPage never read the setting back and ScanInput always rendered
  // the search box unconditionally. StationPage now threads
  // `settings.manual_search_enabled` into ScanInput's `manualSearchEnabled`
  // prop (ScanInput.test.tsx owns the exhaustive per-mode/functional
  // coverage of the prop itself; this is the end-to-end proof the wiring
  // from the settings response actually reaches it).
  it("hides the manual search box when settings.manual_search_enabled is false, without affecting the wedge scan-input mechanism", async () => {
    settingsOverride = { ...settingsOverride, manual_search_enabled: false };
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    expect(screen.queryByPlaceholderText("Search by name, email, or code…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Badge scanner input")).toBeInTheDocument();
  });

  it("shows the manual search box when settings.manual_search_enabled is true (the default)", async () => {
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    expect(screen.getByPlaceholderText("Search by name, email, or code…")).toBeInTheDocument();
  });

  it("a wedge scan of a known code shows the checked_in verdict card through the mapped verdictClasses", async () => {
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    await user.type(screen.getByLabelText("Badge scanner input"), "CODE1{Enter}");

    const card = await screen.findByTestId("checkin-verdict-card");
    expect(card).toHaveAttribute("data-verdict", "allowed");
    expect(card.className).toContain(verdictClasses.allowed.bg);
    expect(within(card).getByText("Checked in").className).toContain(verdictClasses.allowed.text);
    expect(within(card).getByText("Ada Lovelace", { exact: false })).toBeInTheDocument();
    expect(checkinHitCount).toBe(1);
  });

  it("a repeat scan shows the already_checked_in verdict card (the info/repeat verdictClasses) with the first-scan metadata line", async () => {
    checkinOutcome = "already_checked_in";
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    await user.type(screen.getByLabelText("Badge scanner input"), "CODE1{Enter}");

    const card = await screen.findByTestId("checkin-verdict-card");
    expect(card).toHaveAttribute("data-verdict", "already_checked_in");
    expect(card.className).toContain(verdictClasses.already_checked_in.bg);
    expect(within(card).getByText("Already checked in").className).toContain(verdictClasses.already_checked_in.text);

    const meta = screen.getByTestId("checkin-first-scan-meta");
    expect(meta).toHaveTextContent("12:34");
    expect(meta).toHaveTextContent("Main Door");
  });

  it("an unrecognized code shows the not_registered verdict card, without ever calling the check-in endpoint", async () => {
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    await user.type(screen.getByLabelText("Badge scanner input"), "NO-SUCH-CODE{Enter}");

    const card = await screen.findByTestId("checkin-verdict-card");
    expect(card).toHaveAttribute("data-verdict", "not_registered");
    expect(card.className).toContain(verdictClasses.not_registered.bg);
    expect(within(card).getByText("Not registered").className).toContain(verdictClasses.not_registered.text);
    expect(checkinHitCount).toBe(0);
  });
});

// P4.1 Task 10 -- degraded mode. useConnectionState (its own dedicated unit
// tests live in useConnectionState.test.tsx) folds `navigator.onLine`/the
// window 'online'/'offline' events and the checkin-actions feed's own
// isError into one debounced `online` boolean; these tests prove StationPage
// actually WIRES that signal into the three required reactions: the amber
// banner, an inert scan (no POST, an explicit offline verdict instead of
// silently dropping it), and the manual search's check-in CTA disappearing
// (read-only against whatever's already in the query cache) -- see this
// task's brief and the spec's §4 "Degraded mode (2d)".
function goOffline() {
  Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });
  window.dispatchEvent(new Event("offline"));
}

function goOnline() {
  Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  window.dispatchEvent(new Event("online"));
}

describe("StationPage — degraded mode", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    checkinOutcome = "checked_in";
    checkinHitCount = 0;
    settingsOverride = {
      print_on_checkin: false,
      verdict_auto_dismiss_sec: 30,
      scan_input: "wedge",
      manual_search_enabled: true,
    };
    goOnline();
  });

  afterEach(() => {
    goOnline();
  });

  it("shows the amber 'Connection is unstable' banner while offline, and hides it again on reconnect", async () => {
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");
    expect(screen.queryByTestId("checkin-degraded-banner")).not.toBeInTheDocument();

    goOffline();
    expect(await screen.findByTestId("checkin-degraded-banner")).toHaveTextContent("Connection is unstable");

    goOnline();
    await waitFor(() => expect(screen.queryByTestId("checkin-degraded-banner")).not.toBeInTheDocument());
  });

  it("blocks a wedge scan while offline -- no check-in POST fires, an explicit offline verdict shows instead -- then lets a scan through again once reconnected", async () => {
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    goOffline();
    await screen.findByTestId("checkin-degraded-banner");

    await user.type(screen.getByLabelText("Badge scanner input"), "CODE1{Enter}");

    expect(await screen.findByTestId("checkin-verdict-offline")).toHaveTextContent("Can't check in — offline.");
    expect(checkinHitCount).toBe(0);
    expect(screen.queryByTestId("checkin-verdict-card")).not.toBeInTheDocument();

    goOnline();
    await waitFor(() => expect(screen.queryByTestId("checkin-degraded-banner")).not.toBeInTheDocument());

    await user.type(screen.getByLabelText("Badge scanner input"), "CODE1{Enter}");

    const card = await screen.findByTestId("checkin-verdict-card");
    expect(card).toHaveAttribute("data-verdict", "allowed");
    expect(checkinHitCount).toBe(1);
  });

  it("manual search stays read-only while offline -- the cached result still shows, but with no check-in button -- and picking it does not check anyone in", async () => {
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");

    const searchBox = screen.getByPlaceholderText("Search by name, email, or code…");
    await user.type(searchBox, "Ada");
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    // Online: the result is a real check-in CTA.
    expect(screen.getByRole("button", { name: /Ada Lovelace/ })).toBeInTheDocument();

    goOffline();
    await screen.findByTestId("checkin-degraded-banner");

    // Still visible (the already-loaded/cached result), but no longer a
    // clickable check-in CTA.
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ada Lovelace/ })).not.toBeInTheDocument();

    await user.click(screen.getByText("Ada Lovelace"));
    expect(checkinHitCount).toBe(0);
    expect(screen.queryByTestId("checkin-verdict-card")).not.toBeInTheDocument();
  });

  it("disables the recent-scans rail's Undo trigger while offline", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/checkin-actions", () =>
        HttpResponse.json({
          actions: [
            {
              id: "ca-1",
              action: "checkin",
              station_id: "st-1",
              created_at: "2026-01-01T00:00:00Z",
              attendee: { id: "att-1", first_name: "Ada", last_name: "Lovelace", code: "CODE1" },
            },
          ],
        }),
      ),
    );
    renderCorrectAt("/events/evt-1/checkin?station=st-1");
    await screen.findByText("Main Door");
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    expect(undoButton).toBeEnabled();

    goOffline();
    await screen.findByTestId("checkin-degraded-banner");

    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled());
  });
});
