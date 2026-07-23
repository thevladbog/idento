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
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  // `queryClient` returned alongside `router` (PR #81 bot round Finding C6)
  // so tests can trigger an explicit background refetch via
  // `queryClient.invalidateQueries()` -- the same exposed-QueryClient +
  // `server.use` MSW-override idiom BadgeEditorPage.test.tsx's own
  // background-refetch test uses -- rather than a fresh remount, which
  // would prove nothing about retaining ALREADY-rendered stale data.
  return { router, queryClient };
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

// P4.2 Task 8's carried-over BINDING item from Task 7's review: at least
// one test where the stream mock emits a real "hello" frame and the
// header's live-state ring appears (Task 7 wired the ring but never
// exercised it). The "MonitorPage -- stream status" describe block below
// overrides the always-open, never-framed `monitorStreamHandler()` above
// with THIS hand-driven, controlled stream -- same deferred/controlled
// `ReadableStream` idiom as useMonitorStream.test.tsx's own
// `makeSseStream` (real timers throughout, no fake clock, per that file's
// own documented rationale: fake timers + MSW streaming don't mix here).
function makeSseStream() {
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    push(frame: string) {
      controllerRef.enqueue(encoder.encode(frame));
    },
    close() {
      controllerRef.close();
    },
  };
}

type StreamConnection = ReturnType<typeof makeSseStream>;
let streamConnections: StreamConnection[] = [];

function controlledMonitorStreamHandler() {
  return http.get("http://api.test/api/events/:eventId/monitor/stream", () => {
    const conn = makeSseStream();
    streamConnections.push(conn);
    return new HttpResponse(conn.stream, { headers: { "Content-Type": "text/event-stream" } });
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

// P4.2 Task 8 -- Stations card: board 7e's own answer to "how stale is
// stale" (p4.2-board-7e-extract.md) is a per-row amber dot PLUS a text
// duration label, never color alone. `last_seen_at` timestamps below are
// either "right now" (always fresh, however slowly this test itself runs)
// or a fixed far-past date (always stale by any realistic wall clock) --
// deliberately far enough from the 45s threshold in either direction that
// this doesn't need to control MonitorPage's own `Date.now()`-seeded
// ticker state (liveness.test.ts already pins the exact 44.9s/45.1s
// boundary in isolation).
describe("MonitorPage -- Stations card (liveness)", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
  });

  it("shows a fresh station's green dot and count, with NO stale-duration label", async () => {
    monitorSnapshot = snapshotBody({
      stations: [
        { id: "st-1", name: "Kiosk A", zone_id: null, last_seen_at: new Date().toISOString(), checkin_count: 12 },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    expect(await screen.findByText("Kiosk A")).toBeInTheDocument();
    // PR #81 round-2 convergence Finding 5: the dot is now composed from
    // @idento/ui's StatusPill (variant="bare") -- the testid'd element is
    // StationsCard's own wrapper span (same "wrap StatusPill in a testid'd
    // span" idiom as the header's monitor-live-pill/monitor-reconnecting-
    // badge below), and the color class lives on StatusPill's own inner dot
    // node, found via querySelector -- mirrors monitor-live-pill's own
    // `.querySelector(".animate-ping")` idiom for reaching into the
    // primitive's internals.
    const dot1 = screen.getByTestId("monitor-station-dot-st-1").querySelector(".rounded-full");
    expect(dot1).toHaveClass("bg-success");
    expect(dot1).not.toHaveClass("bg-warning");
    expect(screen.queryByTestId("monitor-station-stale-st-1")).not.toBeInTheDocument();
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument();
    // PR #81 round-3 convergence, UI Finding 4 (CodeRabbit facet): a fresh
    // row now ALSO renders its own visible muted "Online" status word next
    // to the dot -- the green dot is never the sole channel conveying
    // liveness (never color alone).
    expect(screen.getByTestId("monitor-station-online-st-1")).toHaveTextContent("Online");
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows a stale station's amber dot AND a text 'stale Ns' duration label -- never color alone", async () => {
    monitorSnapshot = snapshotBody({
      stations: [
        { id: "st-2", name: "Mobile 1", zone_id: null, last_seen_at: "2000-01-01T00:00:00.000Z", checkin_count: 3 },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    expect(await screen.findByText("Mobile 1")).toBeInTheDocument();
    const dot2 = screen.getByTestId("monitor-station-dot-st-2").querySelector(".rounded-full");
    expect(dot2).toHaveClass("bg-warning");
    expect(dot2).not.toHaveClass("bg-success");
    expect(screen.getByTestId("monitor-station-stale-st-2")).toHaveTextContent(/stale \d+ s/);
  });

  // PR #81 round-3 convergence, UI Finding 4 (Codex facet): the primitive's
  // `label` is now rendered as REAL, visually-hidden (sr-only) DOM text
  // inside StatusPill's bare-variant root -- not an `aria-label` attribute
  // on a generic, non-focusable span, which many assistive-tech paths don't
  // reliably announce. This still gives assistive tech a description of the
  // dot even for a fresh station.
  it("exposes an sr-only accessible label on the dot even when fresh, as real DOM text (not aria-label)", async () => {
    monitorSnapshot = snapshotBody({
      stations: [
        { id: "st-3", name: "Kiosk C", zone_id: null, last_seen_at: new Date().toISOString(), checkin_count: 0 },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("Kiosk C");
    // The sr-only label lives on StatusPill's own bare-variant root node, a
    // child of StationsCard's testid'd wrapper span -- same "reach into the
    // primitive via querySelector" idiom as the color-class assertions
    // above.
    const dotRoot = screen.getByTestId("monitor-station-dot-st-3");
    expect(dotRoot.querySelector("[aria-label]")).toBeNull();
    const srOnlyLabel = dotRoot.querySelector(".sr-only");
    expect(srOnlyLabel).not.toBeNull();
    expect(srOnlyLabel?.textContent).not.toBe("");
  });

  // PR #81 round-3 convergence, UI Finding 4 (CodeRabbit facet): a fresh
  // row's dot alone must never be the ONLY channel conveying "online" --
  // this station's row also carries its own separate, VISIBLE muted status
  // word (distinct from the dot's own sr-only label above).
  it("shows a fresh station's own visible muted 'Online' status word, not just a colored dot", async () => {
    monitorSnapshot = snapshotBody({
      stations: [
        { id: "st-4", name: "Kiosk D", zone_id: null, last_seen_at: new Date().toISOString(), checkin_count: 5 },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("Kiosk D");
    expect(screen.getByTestId("monitor-station-online-st-4")).toHaveTextContent("Online");
  });
});

// P4.2 Task 8 -- Last-scans (Recent feed) card: board 7e's own copy is
// explicit -- "compact rows: bare stroke icon (no circle badge) + name/
// zone + mono timestamp, no action buttons (read-only)". CheckinActionRow's
// `action` is "checkin" | "undo" | "reprint" -- and checkin_actions only
// ever logs a 'checkin' row on outcome "checked_in" (backend
// pg_store_checkin_test.go's own comment: "never already_checked_in, never
// an [other outcome]"), so a checkin row is ALWAYS the `allowed` verdict --
// the ONLY verdict this card ever renders. undo/reprint are explicitly NOT
// verdicts (Global Constraints) -- neutral muted icons, asserted below as
// carrying no `text-verdict-*` class at all, not just "a different one".
describe("MonitorPage -- Recent feed card (read-only)", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
  });

  it("renders a checkin row with the verdictClasses.allowed icon/color, a mono HH:MM:SS timestamp, and NO action buttons anywhere in the card", async () => {
    monitorSnapshot = snapshotBody({
      recent: [
        {
          id: "act-1",
          action: "checkin",
          station_id: null,
          created_at: "2026-07-18T09:05:03.000Z",
          attendee: { id: "att-1", first_name: "Ada", last_name: "Lovelace", code: "C1" },
        },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    const row = await screen.findByTestId("monitor-recent-row-act-1");
    expect(row).toHaveTextContent("Ada Lovelace");
    expect(row).toHaveTextContent("09:05:03");

    const icon = row.querySelector("svg");
    expect(icon).toHaveClass("text-verdict-allowed");

    expect(within(screen.getByTestId("monitor-recent-card")).queryAllByRole("button")).toHaveLength(0);

    // PR #81 round-2 convergence Finding 4: the icon alone is `aria-hidden`
    // -- a screen reader must still be able to tell this row apart from an
    // undo/reprint row via a visually-hidden text label.
    expect(screen.getByTestId("monitor-recent-action-act-1")).toHaveTextContent("Checked in");
  });

  it("renders undo/reprint rows with a neutral muted icon -- asserted as carrying NO verdict color class at all", async () => {
    monitorSnapshot = snapshotBody({
      recent: [
        {
          id: "act-2",
          action: "undo",
          station_id: null,
          created_at: "2026-07-18T09:06:00.000Z",
          attendee: { id: "att-2", first_name: "Grace", last_name: "Hopper", code: "C2" },
        },
        {
          id: "act-3",
          action: "reprint",
          station_id: null,
          created_at: "2026-07-18T09:07:00.000Z",
          attendee: { id: "att-3", first_name: "Alan", last_name: "Turing", code: "C3" },
        },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    const undoRow = await screen.findByTestId("monitor-recent-row-act-2");
    const undoIcon = undoRow.querySelector("svg");
    expect(undoIcon).toHaveClass("text-muted-foreground");
    expect(Array.from(undoIcon?.classList ?? []).some((c) => c.startsWith("text-verdict-"))).toBe(false);

    const reprintRow = screen.getByTestId("monitor-recent-row-act-3");
    const reprintIcon = reprintRow.querySelector("svg");
    expect(reprintIcon).toHaveClass("text-muted-foreground");
    expect(Array.from(reprintIcon?.classList ?? []).some((c) => c.startsWith("text-verdict-"))).toBe(false);
  });

  // PR #81 round-2 convergence Finding 4: undo/reprint rows used to be
  // distinguishable from a checkin row ONLY by an `aria-hidden` icon -- a
  // screen reader heard just name/zone/time, indistinguishable from a
  // check-in. Every one of the three action types now carries its own
  // visually-hidden, localized accessible text.
  it("gives each of the three action types its own distinguishable accessible text (screen-reader-only)", async () => {
    monitorSnapshot = snapshotBody({
      recent: [
        {
          id: "act-7",
          action: "checkin",
          station_id: null,
          created_at: "2026-07-18T09:11:00.000Z",
          attendee: { id: "att-7", first_name: "Marie", last_name: "Curie", code: "C7" },
        },
        {
          id: "act-8",
          action: "undo",
          station_id: null,
          created_at: "2026-07-18T09:12:00.000Z",
          attendee: { id: "att-8", first_name: "Niels", last_name: "Bohr", code: "C8" },
        },
        {
          id: "act-9",
          action: "reprint",
          station_id: null,
          created_at: "2026-07-18T09:13:00.000Z",
          attendee: { id: "att-9", first_name: "Rosalind", last_name: "Yalow", code: "C9" },
        },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByTestId("monitor-recent-row-act-7");
    const checkinText = screen.getByTestId("monitor-recent-action-act-7").textContent;
    const undoText = screen.getByTestId("monitor-recent-action-act-8").textContent;
    const reprintText = screen.getByTestId("monitor-recent-action-act-9").textContent;

    expect(checkinText).toBeTruthy();
    expect(undoText).toBeTruthy();
    expect(reprintText).toBeTruthy();
    // All three distinguishable from each other -- the actual bug (icon-only
    // differentiation) let all three read identically to assistive tech.
    expect(new Set([checkinText, undoText, reprintText]).size).toBe(3);

    // The label lives in an `sr-only` node, not visible body copy.
    expect(screen.getByTestId("monitor-recent-action-act-7")).toHaveClass("sr-only");
    expect(screen.getByTestId("monitor-recent-action-act-8")).toHaveClass("sr-only");
    expect(screen.getByTestId("monitor-recent-action-act-9")).toHaveClass("sr-only");
  });

  it("derives the zone name for a row via its station's zone when derivable, and omits it (no placeholder) when the chain is broken", async () => {
    monitorSnapshot = snapshotBody({
      zones: [{ zone_id: "z-1", name: "Main hall", checked_in: 1 }],
      stations: [
        { id: "st-1", name: "Kiosk A", zone_id: "z-1", last_seen_at: new Date().toISOString(), checkin_count: 1 },
        { id: "st-2", name: "Kiosk B", zone_id: null, last_seen_at: new Date().toISOString(), checkin_count: 0 },
      ],
      recent: [
        {
          id: "act-4",
          action: "checkin",
          station_id: "st-1", // has a zone -> derivable.
          created_at: "2026-07-18T09:08:00.000Z",
          attendee: { id: "att-4", first_name: "Rosalind", last_name: "Franklin", code: "C4" },
        },
        {
          id: "act-5",
          action: "checkin",
          station_id: "st-2", // station has no zone -> not derivable.
          created_at: "2026-07-18T09:09:00.000Z",
          attendee: { id: "att-5", first_name: "Katherine", last_name: "Johnson", code: "C5" },
        },
        {
          id: "act-6",
          action: "checkin",
          station_id: null, // station-less row -> not derivable.
          created_at: "2026-07-18T09:10:00.000Z",
          attendee: { id: "att-6", first_name: "Dorothy", last_name: "Vaughan", code: "C6" },
        },
      ],
    });
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByTestId("monitor-recent-row-act-4");
    expect(screen.getByTestId("monitor-recent-zone-act-4")).toHaveTextContent("Main hall");
    expect(screen.queryByTestId("monitor-recent-zone-act-5")).not.toBeInTheDocument();
    expect(screen.queryByTestId("monitor-recent-zone-act-6")).not.toBeInTheDocument();
  });
});

// P4.2 Task 8 -- header stream-status coverage (connecting/live/
// reconnecting), including the carried-over BINDING item from Task 7's own
// review: at least one test proving the header's live-state ring actually
// appears once a real "hello" frame arrives (Task 7 wired it but never
// exercised the `live` branch). Overrides the module-level
// `monitorStreamHandler()` (always-open, never-framed -- "connecting"
// forever, used by every OTHER describe block above) with the
// hand-driven `controlledMonitorStreamHandler()` so this block alone can
// drive hello/close frames and observe connecting -> live -> reconnecting
// -> live.
// PR #81 bot round Finding C1: the live-state ring is now StatusPill's own
// `indicator="dot" pulse` rendering (packages/ui/src/components/status-
// pill.tsx), not a dedicated `monitor-live-ring` testid -- queried here via
// its stable `.animate-ping` class, scoped inside the `monitor-live-pill`
// wrapper (the same "assert via class, not a sub-element testid" idiom
// packages/ui's own agent-status.test.tsx uses for its dot indicator).
function liveRing(): Element | null {
  return screen.getByTestId("monitor-live-pill").querySelector(".animate-ping");
}

describe("MonitorPage -- stream status (connecting/live/reconnecting/error)", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    monitorSnapshot = snapshotBody();
    streamConnections = [];
    server.use(controlledMonitorStreamHandler());
  });

  it("shows no reconnecting badge and no live ring while still connecting, then shows the live ring once the hello frame arrives", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("1,284 / 2,410");
    expect(liveRing()).not.toBeInTheDocument();
    expect(screen.queryByTestId("monitor-reconnecting-badge")).not.toBeInTheDocument();

    await waitFor(() => expect(streamConnections.length).toBe(1));
    streamConnections[0].push("event: hello\ndata: {}\n\n");

    await waitFor(() => expect(liveRing()).toBeInTheDocument());
    expect(screen.queryByTestId("monitor-reconnecting-badge")).not.toBeInTheDocument();
  });

  it(
    "shows the amber reconnecting badge over the already-fetched (now stale) snapshot data once the stream disconnects, and hides it again after a successful reconnect",
    async () => {
      renderCorrectAt("/events/evt-1/monitor");

      await screen.findByText("1,284 / 2,410");
      await waitFor(() => expect(streamConnections.length).toBe(1));
      streamConnections[0].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(liveRing()).toBeInTheDocument());

      streamConnections[0].close();

      await waitFor(() => expect(screen.getByTestId("monitor-reconnecting-badge")).toBeInTheDocument());
      // Global Constraints: "on stream failure show a reconnecting badge
      // over stale data" -- the totals card's own numbers must still be
      // on screen, not blanked out just because the stream is down.
      expect(screen.getByText("1,284 / 2,410")).toBeInTheDocument();

      // Backoff is 1s base +/-25% jitter (max 1250ms) -- bounded wait for
      // the retried connect() to land as a brand-new request.
      await waitFor(() => expect(streamConnections.length).toBe(2), { timeout: 3000 });
      streamConnections[1].push("event: hello\ndata: {}\n\n");

      await waitFor(() => expect(screen.queryByTestId("monitor-reconnecting-badge")).not.toBeInTheDocument());
    },
    8000,
  );

  // PR #81 bot round Finding C3: a terminal stream failure (this test uses a
  // documented 404 -- no global tenant/session side effect to also assert,
  // that's useMonitorStream.test.tsx's own concern) replaces the LIVE pill
  // entirely with a destructive error badge instead of looping the
  // "reconnecting" badge forever, while the already-fetched snapshot stays
  // rendered underneath it (Finding C6 -- retain-last-known-good).
  it("replaces the LIVE pill with a destructive stream-error badge on a terminal 4xx, keeping the already-fetched snapshot rendered", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor/stream", () => new HttpResponse(null, { status: 404 })),
    );
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("1,284 / 2,410");
    await waitFor(() => expect(screen.getByTestId("monitor-stream-error-badge")).toBeInTheDocument());
    expect(screen.queryByTestId("monitor-live-pill")).not.toBeInTheDocument();
    expect(screen.queryByTestId("monitor-reconnecting-badge")).not.toBeInTheDocument();
    expect(screen.getByText("1,284 / 2,410")).toBeInTheDocument();

    // Terminal means terminal -- no reconnect attempt ever lands.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(streamConnections.length).toBe(0);
    expect(screen.getByTestId("monitor-stream-error-badge")).toBeInTheDocument();
  }, 5000);

  // P6.2 Task 2 -- board 8p's staleness vocabulary: a degraded stream never
  // lets stale numbers masquerade as live. Reuses this block's own
  // hello/close-driven `controlledMonitorStreamHandler()` harness exactly as
  // the reconnecting-badge test above does, so "reconnecting" here is the
  // real derived `stream.status`, not a hand-set prop.
  it(
    "dims the body to 60% while the stream is reconnecting, restoring it when live",
    async () => {
      renderCorrectAt("/events/evt-1/monitor");

      await screen.findByText("1,284 / 2,410");
      await waitFor(() => expect(streamConnections.length).toBe(1));
      streamConnections[0].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(liveRing()).toBeInTheDocument());
      expect(screen.getByTestId("monitor-body")).not.toHaveClass("opacity-60");

      streamConnections[0].close();
      await waitFor(() => expect(screen.getByTestId("monitor-reconnecting-badge")).toBeInTheDocument());
      expect(screen.getByTestId("monitor-body")).toHaveClass("opacity-60");

      // Backoff is 1s base +/-25% jitter (max 1250ms) -- bounded wait for
      // the retried connect() to land as a brand-new request, same as the
      // reconnecting-badge test above.
      await waitFor(() => expect(streamConnections.length).toBe(2), { timeout: 3000 });
      streamConnections[1].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(screen.queryByTestId("monitor-reconnecting-badge")).not.toBeInTheDocument());
      expect(screen.getByTestId("monitor-body")).not.toHaveClass("opacity-60");
    },
    8000,
  );

  it("keeps the body at full opacity while the stream is live", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("1,284 / 2,410");
    await waitFor(() => expect(streamConnections.length).toBe(1));
    streamConnections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(liveRing()).toBeInTheDocument());

    expect(screen.getByTestId("monitor-body")).not.toHaveClass("opacity-60");
  });

  it("announces stream-state changes via a polite live region", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("1,284 / 2,410");
    await waitFor(() => expect(streamConnections.length).toBe(1));
    streamConnections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(liveRing()).toBeInTheDocument());
    streamConnections[0].close();
    await waitFor(() => expect(screen.getByTestId("monitor-reconnecting-badge")).toBeInTheDocument());

    const region = screen.getByTestId("monitor-stream-announcer");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
    expect(region).toHaveTextContent("Reconnecting");
  });

  // Fix round 1 (P6.2 T2 review finding): before the SSE hello frame
  // arrives, `stream.status` is genuinely "connecting" -- reusing the exact
  // same harness as the "shows no reconnecting badge and no live ring while
  // still connecting" test above -- and must not be announced as a stream
  // error. Previously the announcer's ternary chain used `error` as a
  // catch-all `else`, so this ordinary pre-hello moment on every mount was
  // mislabeled "Live updates unavailable".
  it("announces nothing while the stream is still connecting (not yet live, not yet a real error)", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("1,284 / 2,410");
    expect(liveRing()).not.toBeInTheDocument();
    expect(screen.queryByTestId("monitor-reconnecting-badge")).not.toBeInTheDocument();

    const announcer = await screen.findByTestId("monitor-stream-announcer");
    expect(announcer).toHaveTextContent("");
  });

  it("renders the updated-ago counter in warning tone with a clock icon while the stream is degraded", async () => {
    renderCorrectAt("/events/evt-1/monitor");

    await screen.findByText("1,284 / 2,410");
    await waitFor(() => expect(streamConnections.length).toBe(1));
    streamConnections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(liveRing()).toBeInTheDocument());
    streamConnections[0].close();
    await waitFor(() => expect(screen.getByTestId("monitor-reconnecting-badge")).toBeInTheDocument());

    const counter = await screen.findByTestId("monitor-updated-ago");
    expect(counter).toHaveClass("text-warning");
    expect(counter).not.toHaveClass("text-muted-foreground");
    // WCAG 1.4.1 -- color is never the only channel: a clock icon
    // accompanies the amber tone, alongside the counter's own numeric text.
    expect(counter.querySelector("svg")).toBeInTheDocument();
  });
});

// PR #81 bot round Finding C6: retain-last-known-good. A single failed
// BACKGROUND refetch (isError=true, data still retained per react-query)
// must not blank an already-successfully-rendered page into an error card --
// exercised here via the exposed-`queryClient` + `server.use` MSW-override +
// explicit `invalidateQueries()` idiom (not a fresh remount, which would
// prove nothing about retaining ALREADY-rendered content).
describe("MonitorPage -- retains stale data across a failed background refetch (C6)", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    monitorSnapshot = snapshotBody();
  });

  it("keeps rendering the snapshot content after a background refetch fails", async () => {
    const { queryClient } = renderCorrectAt("/events/evt-1/monitor");

    expect(await screen.findByText("1,284 / 2,410")).toBeInTheDocument();
    expect(screen.getByText("Main hall")).toBeInTheDocument();

    server.use(
      http.get("http://api.test/api/events/:eventId/monitor", () => new HttpResponse(null, { status: 500 })),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/events/{event_id}/monitor"] });
    });

    // The failed refetch must not have replaced the content with the
    // snapshot-error card -- `getBy` (not `findBy`) proves it's the SAME
    // still-mounted content, not a fresh success re-render.
    expect(screen.getByText("1,284 / 2,410")).toBeInTheDocument();
    expect(screen.getByText("Main hall")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-snapshot-error")).not.toBeInTheDocument();
  });

  it("keeps rendering the event header after a background event refetch fails", async () => {
    const { queryClient } = renderCorrectAt("/events/evt-1/monitor");

    expect(await screen.findByRole("heading", { name: "Partner Day — Autumn" })).toBeInTheDocument();

    server.use(http.get("http://api.test/api/events/:id", () => new HttpResponse(null, { status: 500 })));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/events/{id}"] });
    });

    expect(screen.getByRole("heading", { name: "Partner Day — Autumn" })).toBeInTheDocument();
    expect(screen.getByTestId("monitor-page")).toBeInTheDocument();
  });
});
