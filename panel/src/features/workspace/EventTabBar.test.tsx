import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventTabBar } from "./EventTabBar";
import "../../shared/i18n";

function renderAt(path: string) {
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
  render(<RouterProvider router={router as never} />);
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
});
