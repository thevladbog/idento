import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { BadgeEditorPage } from "./BadgeEditorPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Mirrors AttendeesPage.test.tsx / WorkspaceOverview.test.tsx's harness shape:
// a throwaway route tree whose id/path structure matches the real app
// closely enough for `getRouteApi("/_app/events/$eventId/badge").useParams()`
// to resolve, without reconstructing EventWorkspaceLayout's own rail/header
// (that's EventWorkspaceLayout.test.tsx's job — this page fetches its own
// badge-template data, same as WorkspaceOverview does for readiness/stats).
function buildRouter() {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const badgeRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/badge", component: BadgeEditorPage });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([badgeRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/events/evt-1/badge"] }) });
}

function renderPage() {
  const router = buildRouter();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton — same rationale as
          AttendeesPage.test.tsx / WorkspaceOverview.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

let templateResponse: unknown = { template: null, version: 0 };
let templateStatus = 200;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/badge-template", () => {
    if (templateStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: templateStatus });
    }
    return HttpResponse.json(templateResponse);
  }),
);
void server;

describe("BadgeEditorPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
  });

  it("renders the top bar title and the locked Test print / ZPL preview actions", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Badge editor" })).toBeInTheDocument();
    const testPrint = screen.getByRole("button", { name: /Test print/ });
    const zplPreview = screen.getByRole("button", { name: /ZPL preview/ });
    expect(testPrint).toBeDisabled();
    expect(zplPreview).toBeDisabled();
  });

  it("shows skeleton panes and no pane content while the template query is loading", async () => {
    renderPage();

    // Mirrors ZonesPage.test.tsx's "shows loading skeletons" test: this
    // harness's route is nested one level under the workspace route (not an
    // index route), so the very first render is `findBy` (route matching),
    // not a synchronous assertion.
    expect((await screen.findAllByTestId("badge-pane-skeleton")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("badge-pane-elements")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-pane-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-pane-properties")).not.toBeInTheDocument();
  });

  it("shows load-error copy (distinct from the empty-state copy) and a retry action when the template fetch fails", async () => {
    templateStatus = 500;
    renderPage();

    expect(await screen.findByText("Couldn't load the badge template.")).toBeInTheDocument();
    expect(screen.queryByText("Add your first element")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("falls back to the parseTemplateDoc(null) default doc and shows the empty-state guidance when the event has no template yet", async () => {
    templateResponse = { template: null, version: 0 };
    renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(screen.getByText("Add your first element")).toBeInTheDocument();
    // parseTemplateDoc(null)'s defaults (90 x 55mm @ 300 dpi) surface in the
    // empty-state body — proves the reducer was actually seeded from the
    // resolved query data, not left at some other placeholder value.
    expect(canvas.textContent).toMatch(/90/);
    expect(canvas.textContent).toMatch(/55/);
    expect(canvas.textContent).toMatch(/300/);
  });

  it("renders the elements and properties pane placeholders once the template query resolves", async () => {
    renderPage();

    expect(await screen.findByTestId("badge-pane-elements")).toBeInTheDocument();
    expect(screen.getByTestId("badge-pane-properties")).toBeInTheDocument();
  });

  it("shows the canvas placeholder (not the empty-state guidance) once the template already has elements", async () => {
    templateResponse = {
      template: {
        width_mm: 90,
        height_mm: 55,
        dpi: 300,
        elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "{first_name}" }],
      },
      version: 2,
    };
    renderPage();

    await screen.findByTestId("badge-pane-canvas");
    expect(screen.queryByText("Add your first element")).not.toBeInTheDocument();
  });
});
