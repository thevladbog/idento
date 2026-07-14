import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { EventWorkspaceStub } from "./EventWorkspaceStub";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Isolated route tree matching the real app's shape closely enough for
// `EventWorkspaceStub`'s `getRouteApi("/_app/events/$eventId").useParams()`
// to resolve: that id string is app/router.tsx's real `_app` pathless
// layout id plus this route's `/events/$eventId` path, and `getRouteApi`
// looks up the active match by that id string against whichever router is
// in context — not by JS object identity — so this test router reconstructs
// the same pathless-layout-id shape (without pulling in the real
// ProtectedLayout's auth machinery).
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const homeRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/", component: () => <div>home content</div> });
  const eventRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/events/$eventId", component: EventWorkspaceStub });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([homeRoute, eventRoute])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton (./router.tsx via module
          augmentation), so it won't structurally match RouterProvider's
          globally registered Router type — same rationale as
          ProtectedLayout.test.tsx's identical cast. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

const server = startMswServer(
  http.get("http://api.test/api/events/:id", ({ params }) => {
    if (params.id === "evt-missing") {
      return HttpResponse.json({ error: "not found" }, { status: 404 });
    }
    return HttpResponse.json({ id: params.id, tenant_id: "t1", name: "Tech Summit", created_at: "", updated_at: "" });
  }),
);
void server;

describe("EventWorkspaceStub", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("renders the event's name, the coming-soon copy, and a back-Home link", async () => {
    renderAt("/events/evt-1");

    expect(await screen.findByRole("heading", { name: "Tech Summit" })).toBeInTheDocument();
    expect(screen.getByText("The event workspace arrives in the next update.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Back to Home/ });
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders the load-error message and a back-Home link when the event fetch fails", async () => {
    renderAt("/events/evt-missing");

    expect(await screen.findByText("Couldn't load your events.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Back to Home/ });
    expect(link).toHaveAttribute("href", "/");
    await waitFor(() => expect(screen.queryByRole("heading")).not.toBeInTheDocument());
  });
});
