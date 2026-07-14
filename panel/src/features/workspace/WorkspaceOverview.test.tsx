import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Mirrors EventWorkspaceLayout.test.tsx's harness shape (rootRoute -> "_app"
// -> "/events/$eventId" -> index "/") so `getRouteApi("/_app/events/$eventId")
// .useParams()` inside WorkspaceOverview resolves the same way it does for
// the real app's route tree — but this component does its OWN data fetching
// (readiness/stats/zones), so the parent layout route here is just a plain
// `<Outlet/>` marker, not the real EventWorkspaceLayout.
function buildRouter() {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/events/$eventId", component: () => <Outlet /> });
  const overviewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/", component: WorkspaceOverview });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([overviewRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/events/evt-1"] }) });
}

function renderOverview() {
  const router = buildRouter();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton — same rationale as
          EventWorkspaceLayout.test.tsx / ProtectedLayout.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

const TWO_NOT_DONE_READINESS = {
  ready: false,
  // Deliberately NOT in pipeline order (staff before badge) — the component
  // must render "next" rows in fixed pipeline order (attendees, badge,
  // staff, equipment), not raw array order, and zones is never a "next"
  // candidate even though it's not done here either.
  steps: [
    { key: "attendees", status: "done", count: 340 },
    { key: "staff", status: "not_done" },
    { key: "badge", status: "not_done" },
    { key: "zones", status: "not_done" },
    { key: "equipment", status: "not_done" },
  ],
};

const ALL_READY = {
  ready: true,
  steps: [
    { key: "attendees", status: "done", count: 340 },
    { key: "badge", status: "done" },
    { key: "zones", status: "done", count: 2 },
    { key: "staff", status: "done", count: 3 },
    { key: "equipment", status: "done" },
  ],
};

const ZONES_SKIPPED_READINESS = {
  ready: false,
  steps: [
    { key: "attendees", status: "done", count: 340 },
    { key: "badge", status: "not_done" },
    { key: "zones", status: "skipped", count: 0 },
    { key: "staff", status: "not_done" },
    { key: "equipment", status: "not_done" },
  ],
};

let readinessResponse: unknown = TWO_NOT_DONE_READINESS;
let statsResponse: unknown = { total_attendees: 200, checked_in: 120 };
let zonesResponse: unknown = [
  { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "" },
  { id: "z2", event_id: "evt-1", name: "VIP", zone_type: "vip", order_index: 1, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "" },
  { id: "z3", event_id: "evt-1", name: "Backstage", zone_type: "vip", order_index: 2, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "" },
];

const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () => HttpResponse.json(readinessResponse)),
  http.get("http://api.test/api/events/:eventId/stats", () => HttpResponse.json(statsResponse)),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(zonesResponse)),
);
void server;

describe("WorkspaceOverview", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    readinessResponse = TWO_NOT_DONE_READINESS;
    statsResponse = { total_attendees: 200, checked_in: 120 };
    zonesResponse = [
      { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "" },
      { id: "z2", event_id: "evt-1", name: "VIP", zone_type: "vip", order_index: 1, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "" },
      { id: "z3", event_id: "evt-1", name: "Backstage", zone_type: "vip", order_index: 2, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "" },
    ];
  });

  it("renders the H2 title and subtitle", async () => {
    renderOverview();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Everything your team needs before doors open.")).toBeInTheDocument();
  });

  it("renders exactly the two not-done steps in fixed pipeline order, each with a locked chip and no buttons", async () => {
    renderOverview();

    const list = await screen.findByTestId("workspace-next-steps");
    // badge and staff are not_done; attendees is done (excluded), zones is
    // never a "next" candidate even though it's not_done, and equipment is
    // the 3rd not_done step so it's excluded by the "up to two" cap.
    expect(within(list).getByText("Design the badge template in the editor.")).toBeInTheDocument();
    expect(within(list).getByText("Assign staff and print their QR login cards.")).toBeInTheDocument();
    expect(within(list).queryByText("Import your attendee list to start printing badges.")).not.toBeInTheDocument();
    expect(within(list).queryByText("Connect the venue printer and run a test print.")).not.toBeInTheDocument();

    // Fixed pipeline order (badge before staff), not raw API array order
    // (which listed staff before badge).
    const badgeIndex = list.textContent?.indexOf("Design the badge template in the editor.") ?? -1;
    const staffIndex = list.textContent?.indexOf("Assign staff and print their QR login cards.") ?? -1;
    expect(badgeIndex).toBeGreaterThanOrEqual(0);
    expect(staffIndex).toBeGreaterThan(badgeIndex);

    expect(within(list).getAllByText("Coming soon")).toHaveLength(2);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the all-ready message instead of rows when ready === true", async () => {
    readinessResponse = ALL_READY;
    renderOverview();

    expect(
      await screen.findByText("Everything's ready — launch check-in from the header when doors open."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-next-steps")).not.toBeInTheDocument();
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("renders real readiness counts, checked-in stats, and the first two zone names", async () => {
    readinessResponse = ALL_READY;
    renderOverview();

    const tiles = await screen.findByTestId("workspace-stat-tiles");
    expect(await within(tiles).findByText("340")).toBeInTheDocument(); // attendees
    expect(await within(tiles).findByText("2")).toBeInTheDocument(); // zones count
    expect(await within(tiles).findByText("3")).toBeInTheDocument(); // staff
    expect(await within(tiles).findByText("120")).toBeInTheDocument(); // checked in
    expect(await within(tiles).findByText("/ 200")).toBeInTheDocument();
    expect(await within(tiles).findByText("Main hall · VIP")).toBeInTheDocument();
    expect(within(tiles).queryByText(/Backstage/)).not.toBeInTheDocument();
  });

  it("shows the 'optional, not used' caption on the Zones tile when the zones step is skipped, never real zone names", async () => {
    readinessResponse = ZONES_SKIPPED_READINESS;
    renderOverview();

    const tiles = await screen.findByTestId("workspace-stat-tiles");
    expect(await within(tiles).findByText("Optional — not used")).toBeInTheDocument();
    expect(within(tiles).queryByText(/Main hall/)).not.toBeInTheDocument();
  });

  it("shows an em-dash placeholder on the Checked-in tile (not a fabricated 0 / 0) when stats fail to load", async () => {
    // All-ready readiness so the other three tiles show real (non-zero)
    // counts — isolates this test to the Checked-in tile's own error state
    // instead of colliding with legitimate `0` values elsewhere.
    readinessResponse = ALL_READY;
    server.use(
      http.get("http://api.test/api/events/:eventId/stats", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderOverview();

    const tiles = await screen.findByTestId("workspace-stat-tiles");
    expect(await within(tiles).findByText("340")).toBeInTheDocument(); // other tiles unaffected
    expect(await within(tiles).findByText("—")).toBeInTheDocument();
    expect(within(tiles).queryByText(/\/ 0/)).not.toBeInTheDocument();
    expect(within(tiles).queryByText(/0 \/ 0/)).not.toBeInTheDocument();
  });

  it("shows an em-dash placeholder on only the Zones tile when the zones query fails, leaving the Checked-in tile's real stats intact", async () => {
    readinessResponse = ALL_READY;
    server.use(
      http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderOverview();

    const tiles = await screen.findByTestId("workspace-stat-tiles");
    expect(await within(tiles).findByText("120")).toBeInTheDocument();
    expect(within(tiles).findByText("/ 200")).toBeTruthy();
    // Zones tile's count still comes from readiness (independent of the
    // failed zones-list query) — only its caption falls back to the
    // unavailable placeholder instead of a fabricated/missing zone-name list.
    expect(within(tiles).getByText("2")).toBeInTheDocument();
    await within(tiles).findByText("—");
    expect(within(tiles).queryByText(/Main hall/)).not.toBeInTheDocument();
  });

  it("shows skeleton placeholders, not fabricated zeros, while readiness/stats/zones are still loading", () => {
    renderOverview();

    // Synchronous assertion right after render, before the MSW-mocked
    // responses resolve — mirrors LiveStrip.test.tsx's loading-state guard.
    expect(screen.queryByText("340")).not.toBeInTheDocument();
    expect(screen.queryByText("120")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-next-steps")).not.toBeInTheDocument();
  });
});
