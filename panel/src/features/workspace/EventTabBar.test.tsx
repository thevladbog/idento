import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import {
  act, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventTabBar } from "./EventTabBar";
import { MONITOR_SNAPSHOT_KEY } from "../monitor/hooks";
import { STATION_STALE_MS } from "../monitor/liveness";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

// Real generated MonitorSnapshot shape (components["schemas"]["MonitorSnapshot"],
// schema.d.ts) — note MonitorStationRow keys its station by `id`, not
// `station_id`, and `zone_id` is a required (nullable) field.
const STALE_SNAPSHOT: components["schemas"]["MonitorSnapshot"] = {
  totals: { checked_in: 10, total: 20, rate_per_min: 0, peak: null, est_done_at: null },
  zones: [],
  unattributed: 0,
  stations: [
    // last_seen_at far past STATION_STALE_MS (45s) relative to any test run.
    { id: "st-1", name: "Kiosk A", zone_id: null, checkin_count: 10, last_seen_at: "2020-01-01T00:00:00Z" },
  ],
  recent: [],
};

function freshSnapshotAt(lastSeenAtIso: string): components["schemas"]["MonitorSnapshot"] {
  return {
    totals: { checked_in: 10, total: 20, rate_per_min: 0, peak: null, est_done_at: null },
    zones: [],
    unattributed: 0,
    stations: [{ id: "st-1", name: "Kiosk A", zone_id: null, checkin_count: 10, last_seen_at: lastSeenAtIso }],
    recent: [],
  };
}

function renderAt(path: string, seedSnapshot?: (queryClient: QueryClient) => void) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => (
      <>
        <Outlet />
        <EventTabBar eventId="evt-1" />
      </>
    ),
  });
  const overviewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/", component: () => <div>overview</div> });
  const staffRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/staff", component: () => <div>staff</div> });
  const attendeesRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/attendees", component: () => <div>attendees</div> });
  const badgeRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/badge", component: () => <div>badge</div> });
  const zonesRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/zones", component: () => <div>zones</div> });
  const settingsRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/settings", component: () => <div>settings</div> });
  const monitorRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId/monitor",
    component: () => <div>monitor</div>,
  });
  const equipmentRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/equipment", component: () => <div>equipment</div> });
  const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([
      workspaceRoute.addChildren([overviewRoute, staffRoute, attendeesRoute, badgeRoute, zonesRoute, settingsRoute]),
      monitorRoute,
      equipmentRoute,
    ]),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedSnapshot?.(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("EventTabBar", () => {
  it("renders the four section links plus More, with Overview active at the index route", async () => {
    renderAt("/events/evt-1");
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    expect(within(bar).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "Monitor" })).toHaveAttribute("href", "/events/evt-1/monitor");
    expect(within(bar).getByRole("link", { name: "Attendees" })).toHaveAttribute("href", "/events/evt-1/attendees");
    expect(within(bar).getByRole("link", { name: "Staff" })).toHaveAttribute("href", "/events/evt-1/staff");
    expect(within(bar).getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("marks Staff active on the staff route without aria-current on Overview", async () => {
    renderAt("/events/evt-1/staff");
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    expect(within(bar).getByRole("link", { name: "Staff" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("opens the More sheet listing the desktop-only sections", async () => {
    const user = userEvent.setup();
    renderAt("/events/evt-1");
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    expect(within(bar).getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "false");
    await user.click(within(bar).getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: /Badge editor/ })).toHaveAttribute("href", "/events/evt-1/badge");
    expect(within(sheet).getByRole("link", { name: /Zones & access rules/ })).toHaveAttribute("href", "/events/evt-1/zones");
    expect(within(sheet).getByRole("link", { name: /Event settings/ })).toHaveAttribute("href", "/events/evt-1/settings");
    expect(within(sheet).getByRole("link", { name: /Equipment/ })).toHaveAttribute("href", "/equipment");
  });

  it("closes the More sheet when a row is clicked", async () => {
    const user = userEvent.setup();
    renderAt("/events/evt-1");
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    await user.click(within(bar).getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("link", { name: /Badge editor/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the attention dot with an sr-only label when the cached snapshot has a stale station", async () => {
    renderAt("/events/evt-1", (queryClient) => {
      queryClient.setQueryData(MONITOR_SNAPSHOT_KEY("evt-1"), STALE_SNAPSHOT);
    });
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    expect(within(bar).getByTestId("tab-bar-badge")).toBeInTheDocument();
    expect(within(bar).getByText("A station needs attention")).toHaveClass("sr-only");
  });

  it("shows no dot when nothing is cached (and never fetches on its own)", async () => {
    renderAt("/events/evt-1");
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    expect(within(bar).queryByTestId("tab-bar-badge")).not.toBeInTheDocument();
  });

  it("lights the dot once a cached station crosses staleness purely from the clock advancing, with no cache update", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const now = Date.now();
    // Fresh at render time (well inside STATION_STALE_MS), so the dot must
    // start off — this asserts the fix recomputes over time, not that a
    // stale fixture happens to always read stale.
    const freshLastSeenAt = new Date(now - 1_000).toISOString();
    renderAt("/events/evt-1", (queryClient) => {
      queryClient.setQueryData(MONITOR_SNAPSHOT_KEY("evt-1"), freshSnapshotAt(freshLastSeenAt));
    });
    const bar = await screen.findByRole("navigation", { name: "Event sections" });
    expect(within(bar).queryByTestId("tab-bar-badge")).not.toBeInTheDocument();

    // Advance real elapsed time past STATION_STALE_MS without touching the
    // cache at all — only the local recheck tick should flip the dot on.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATION_STALE_MS + 15_000);
    });
    expect(within(bar).getByTestId("tab-bar-badge")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
