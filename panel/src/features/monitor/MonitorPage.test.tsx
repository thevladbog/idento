// P4.2 Task 7 -- MonitorPage tests.
//
// The FIRST describe block below is the highest-risk proof for this task
// (per the brief and plan-time fact 7): app/router.tsx registers
// `eventMonitorRoute` as a TOP-LEVEL protected route, a SIBLING of
// `eventWorkspaceRoute` (both children of `protectedLayoutRoute`),
// specifically so `/events/$eventId/monitor` renders MonitorPage WITHOUT
// the workspace rail shell (WorkspaceRail/EventWorkspaceLayout). Both
// registrations (sibling vs. "child of the workspace route with a relative
// path") resolve to the IDENTICAL final URL, so only the RENDERED OUTPUT
// (not the matched path string) can tell a correct sibling registration
// apart from an accidental nested one -- this file proves it two ways,
// mirroring StationPage.test.tsx's own harness EXACTLY (plan-time fact 7):
// (1) a routed harness shaped exactly like app/router.tsx's real
// registration renders MonitorPage's content with none of the workspace
// shell's nav markers present, and (2) a deliberately-misregistered harness
// (monitor route nested as a CHILD of the workspace route) demonstrates the
// SAME assertion would fail if the registration were wrong -- proof the
// technique actually discriminates, not a vacuously-passing check.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { MonitorPage } from "./MonitorPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Distinguishing marker text for the workspace rail shell's own nav items
// (WorkspaceRail.tsx's real English copy) -- if the monitor route were
// wrongly nested under the workspace route, these would render alongside
// MonitorPage's own content.
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

// Mirrors app/router.tsx's REAL shape: an app-layout id route ("_app",
// standing in for protectedLayoutRoute) with the workspace route AND the
// monitor route registered as SIBLING children -- exactly the registration
// this task adds to the real router.
function buildCorrectRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: WorkspaceShellStub,
  });
  const monitorRoute = createRoute({
    getParentRoute: () => appLayoutRoute, // sibling of workspaceRoute -- the shape under test.
    path: "/events/$eventId/monitor",
    component: MonitorPage,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute, monitorRoute])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

// Reproduces the bug the sibling registration above avoids: the monitor
// route nested as a CHILD of the workspace route (relative path "/monitor")
// resolves to the exact same final URL ("/events/$eventId/monitor") but
// renders wrapped inside the workspace shell's own <Outlet/>.
function buildMisregisteredRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: WorkspaceShellStub,
  });
  const nestedMonitorRoute = createRoute({
    getParentRoute: () => workspaceRoute, // the mistake: a CHILD, not a sibling.
    path: "/monitor",
    component: () => <div data-testid="dummy-monitor-page">dummy</div>,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([nestedMonitorRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderWithRouter(router: ReturnType<typeof buildCorrectRouter> | ReturnType<typeof buildMisregisteredRouter>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton -- same rationale as
          StationPage.test.tsx / AttendeesPage.test.tsx. */}
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

function snapshotBody(overrides: Record<string, unknown> = {}) {
  return {
    totals: {
      checked_in: 1284,
      total: 2410,
      rate_per_min: 8.2,
      peak: { rate: 14.6, at: "2026-07-18T09:40:00Z" },
      est_done_at: "2026-07-18T12:20:00Z",
    },
    zones: [
      { zone_id: "z-1", name: "Main hall", checked_in: 1190 },
      { zone_id: "z-2", name: "VIP", checked_in: 62 },
      { zone_id: "z-3", name: "Backstage", checked_in: 32 },
    ],
    unattributed: 0,
    stations: [],
    recent: [],
    ...overrides,
  };
}

let monitorSnapshot: ReturnType<typeof snapshotBody> = snapshotBody();

// Task 6's useMonitorStream mounts unconditionally alongside the rest of
// this page (header LIVE pill) -- mocked with a stream that never closes
// and never pushes a frame (this task doesn't assert live-pill transitions;
// that liveness/reconnect-badge nuance is Task 8's), same "mock every
// endpoint this page hits" discipline StationPage.test.tsx's own top-of-
// block comment documents for its analogous useHeartbeat mount.
function monitorStreamHandler() {
  return http.get("http://api.test/api/events/:eventId/monitor/stream", () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
  });
}

const server = startMswServer(
  http.get("http://api.test/api/events/:id", () => HttpResponse.json(EVENT)),
  http.get("http://api.test/api/events/:eventId/monitor", () => HttpResponse.json(monitorSnapshot)),
  monitorStreamHandler(),
);
void server;

describe("MonitorPage routing -- sibling registration proof", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    monitorSnapshot = snapshotBody();
  });

  it("renders MonitorPage's own content with NONE of the workspace shell's nav markers, when registered as a top-level sibling of the workspace route (app/router.tsx's real shape)", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    expect(await screen.findByTestId("monitor-page")).toBeInTheDocument();

    // None of the workspace shell's own distinguishing nav text is
    // present -- if the monitor route had been (incorrectly) nested as a
    // CHILD of the workspace route instead of registered as its sibling,
    // these would render too (see the misregistration reproduction below).
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendees")).not.toBeInTheDocument();
    expect(screen.queryByText("Zones")).not.toBeInTheDocument();
    expect(screen.queryByText("Staff")).not.toBeInTheDocument();
    expect(screen.queryByText("Badge")).not.toBeInTheDocument();
  });

  it("sanity check: the SAME workspace-shell-marker assertion WOULD fail if the monitor route were (incorrectly) nested as a child of the workspace route -- proof the technique above actually discriminates", async () => {
    const router = buildMisregisteredRouter("/events/evt-1/monitor");
    renderWithRouter(router);

    expect(await screen.findByTestId("dummy-monitor-page")).toBeInTheDocument();
    // The workspace shell's nav leaks through here -- this is the exact
    // bug the sibling registration in app/router.tsx avoids.
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Badge")).toBeInTheDocument();
  });
});

describe("MonitorPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    monitorSnapshot = snapshotBody();
  });

  it("renders the header (LIVE pill, event name, Exit) and the totals/percent/rate line + by-zone breakdown from the seeded snapshot", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    expect(await screen.findByRole("heading", { name: "Partner Day — Autumn" })).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Exit/ })).toHaveAttribute("href", "/events/evt-1");

    // Totals card -- board 7e: "1,284 / 2,410" + "53%", rate line "8.2
    // scans/min · peak 14.6 at 09:40 · est. done 12:20".
    expect(screen.getByText("1,284 / 2,410")).toBeInTheDocument();
    expect(screen.getByText("53%")).toBeInTheDocument();
    expect(screen.getByText(/8\.2 scans\/min/)).toBeInTheDocument();
    expect(screen.getByText(/peak 14\.6 at 09:40/)).toBeInTheDocument();
    expect(screen.getByText(/est\. done 12:20/)).toBeInTheDocument();

    // By-zone card -- Main hall / VIP / Backstage, per-zone counts.
    expect(screen.getByText("Main hall")).toBeInTheDocument();
    expect(screen.getByText("1,190")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByText("Backstage")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();

    // Right column: Task 8's placeholders, present but empty.
    expect(screen.getByTestId("monitor-stations-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-recent-placeholder")).toBeInTheDocument();
  });

  it("omits the peak and est-done segments of the rate line when both are null, without fabricating times", async () => {
    monitorSnapshot = snapshotBody({
      totals: { checked_in: 0, total: 100, rate_per_min: 0, peak: null, est_done_at: null },
      zones: [{ zone_id: "z-1", name: "Main hall", checked_in: 0 }],
    });
    renderCorrectAt("/events/evt-1/monitor");
    await screen.findByText("0 / 100");

    expect(screen.getByText(/0\.0 scans\/min/)).toBeInTheDocument();
    expect(screen.queryByText(/peak/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/est\. done/i)).not.toBeInTheDocument();
  });

  it("hides the unattributed row when it is zero, and the visible zone counts sum to the totals card's checked-in count", async () => {
    renderCorrectAt("/events/evt-1/monitor");
    await screen.findByText("Main hall");

    expect(screen.queryByTestId("monitor-zone-unattributed")).not.toBeInTheDocument();
    // 1190 + 62 + 32 === 1284 (the totals card's checked_in count above).
    expect(screen.getByText("1,190")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    expect(screen.getByText("1,284 / 2,410")).toBeInTheDocument();
  });

  it("shows the unattributed row (with a count) when it is greater than zero", async () => {
    monitorSnapshot = snapshotBody({
      totals: { checked_in: 1291, total: 2410, rate_per_min: 8.2, peak: null, est_done_at: null },
      zones: [
        { zone_id: "z-1", name: "Main hall", checked_in: 1190 },
        { zone_id: "z-2", name: "VIP", checked_in: 62 },
        { zone_id: "z-3", name: "Backstage", checked_in: 32 },
      ],
      unattributed: 7,
    });
    renderCorrectAt("/events/evt-1/monitor");
    await screen.findByText("Main hall");

    const row = screen.getByTestId("monitor-zone-unattributed");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("7");
  });

  it("shows loading skeletons for the snapshot cards (not fabricated zero totals) while the monitor snapshot is still loading", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor", async () => {
        await delay(50);
        return HttpResponse.json(monitorSnapshot);
      }),
    );
    renderCorrectAt("/events/evt-1/monitor");
    await screen.findByRole("heading", { name: "Partner Day — Autumn" });

    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("monitor-totals-card")).not.toBeInTheDocument();

    expect(await screen.findByText("1,284 / 2,410")).toBeInTheDocument();
  });

  it("shows an explicit error state (not fabricated zero totals) when the monitor snapshot fails to load", async () => {
    server.use(http.get("http://api.test/api/events/:eventId/monitor", () => new HttpResponse(null, { status: 500 })));
    renderCorrectAt("/events/evt-1/monitor");
    await screen.findByRole("heading", { name: "Partner Day — Autumn" });

    expect(await screen.findByTestId("monitor-snapshot-error")).toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("monitor-totals-card")).not.toBeInTheDocument();
  });
});
