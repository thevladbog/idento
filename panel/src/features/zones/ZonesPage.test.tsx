import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { ZonesPage } from "./ZonesPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Mirrors AttendeesPage.test.tsx's harness shape (throwaway route tree whose
// id/path structure matches the real app closely enough for
// `getRouteApi("/_app/events/$eventId/zones")` to resolve params).
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const zonesRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/zones",
    component: ZonesPage,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([zonesRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error — same rationale as AttendeesPage.test.tsx:
          this test router's route shape differs from the app's registered
          singleton. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

interface ZoneFixture {
  id: string;
  name: string;
  is_registration_zone?: boolean;
  is_active?: boolean;
  access_rules_count?: number;
  settings?: Record<string, unknown>;
}

function zoneWithStats(fixture: ZoneFixture) {
  return {
    zone: {
      id: fixture.id,
      event_id: "evt-1",
      name: fixture.name,
      zone_type: "general",
      order_index: 0,
      is_registration_zone: fixture.is_registration_zone ?? false,
      requires_registration: false,
      is_active: fixture.is_active ?? true,
      settings: fixture.settings,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    total_checkins: 0,
    today_checkins: 0,
    assigned_staff: 0,
    access_rules_count: fixture.access_rules_count ?? 0,
  };
}

let zonesResponse: unknown = [];
let zonesStatus = 200;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/zones", () => {
    if (zonesStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: zonesStatus });
    }
    return HttpResponse.json(zonesResponse);
  }),
);
void server;

describe("ZonesPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    zonesStatus = 200;
    zonesResponse = [
      zoneWithStats({ id: "z1", name: "Main Hall", is_registration_zone: true, access_rules_count: 0 }),
      zoneWithStats({ id: "z2", name: "VIP Lounge", access_rules_count: 2 }),
    ];
  });

  it("renders the header (h2 + mono count) and the caption", async () => {
    renderAt("/events/evt-1/zones");

    expect(await screen.findByRole("heading", { name: "Zones" })).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByText("Optional — attendees always get the entrance zone.")).toBeInTheDocument();
  });

  it("shows the entrance subtitle only for the registration zone", async () => {
    renderAt("/events/evt-1/zones");

    await screen.findByText("Main Hall");
    expect(screen.getAllByText("Entrance zone")).toHaveLength(1);
  });

  it("shows 'All attendees' for a zone with no access rules and the by-rule copy (with the real rule count) for one with rules", async () => {
    renderAt("/events/evt-1/zones");

    await screen.findByText("Main Hall");
    expect(screen.getByText("All attendees")).toBeInTheDocument();
    expect(screen.getByText("By rule · 2")).toBeInTheDocument();
  });

  it("shows a muted 'Inactive' suffix only for zones with is_active === false, and never fabricates it for active zones", async () => {
    zonesResponse = [
      zoneWithStats({ id: "z1", name: "Main Hall", is_registration_zone: true }),
      zoneWithStats({ id: "z3", name: "Backstage", is_active: false }),
    ];
    renderAt("/events/evt-1/zones");

    await screen.findByText("Backstage");
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows loading skeletons and never a fabricated count before the zones arrive", async () => {
    renderAt("/events/evt-1/zones");

    expect(await screen.findByTestId("zones-list-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("zones-total-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Main Hall")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("shows an i18n'd error message, distinct from the empty state, when the fetch fails", async () => {
    zonesStatus = 500;
    renderAt("/events/evt-1/zones");

    expect(await screen.findByText("Couldn't load zones.")).toBeInTheDocument();
    expect(screen.queryByText("No zones yet")).not.toBeInTheDocument();
  });

  it("shows the canonical empty state when there are no zones", async () => {
    zonesResponse = [];
    renderAt("/events/evt-1/zones");

    expect(await screen.findByText("No zones yet")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load zones.")).not.toBeInTheDocument();
  });
});
