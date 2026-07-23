import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { DesktopOnly } from "./DesktopOnly";
import "../i18n";

function installMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(max-width: 767.98px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const homeRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/", component: () => <div>home</div> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const badgeRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/badge",
    component: () => (
      <DesktopOnly flavor="canvas-tool" titleKey="gateBadgeTitle" reasonKey="gateBadgeReason">
        <div>real badge editor</div>
      </DesktopOnly>
    ),
  });
  const equipmentRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/equipment",
    component: () => (
      <DesktopOnly flavor="agent-bound" titleKey="gateEquipmentTitle" reasonKey="gateEquipmentReason">
        <div>real equipment hub</div>
      </DesktopOnly>
    ),
  });
  const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([homeRoute, workspaceRoute.addChildren([badgeRoute]), equipmentRoute]),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router as never} />);
}

describe("DesktopOnly", () => {
  it("renders children unchanged on desktop viewports", async () => {
    installMatchMedia(false);
    renderAt("/events/evt-1/badge");
    expect(await screen.findByText("real badge editor")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Badge editor" })).not.toBeInTheDocument();
  });

  it("renders the gate below md, with a back-to-overview link carrying the eventId", async () => {
    installMatchMedia(true);
    renderAt("/events/evt-1/badge");
    expect(await screen.findByRole("heading", { name: "Badge editor" })).toBeInTheDocument();
    expect(screen.queryByText("real badge editor")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Overview" })).toHaveAttribute("href", "/events/evt-1");
  });

  it("falls back to a back-home link on org-level routes without an eventId", async () => {
    installMatchMedia(true);
    renderAt("/equipment");
    expect(await screen.findByRole("heading", { name: "Equipment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
  });
});
