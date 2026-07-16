import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import {
  act, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
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
  return { router, queryClient };
}

let templateResponse: unknown = { template: null, version: 0 };
let templateStatus = 200;
let fetchCount = 0;

// evt-2 always serves a fixed, visibly-different template (100 × 60 mm @
// 203 dpi) so the cross-event navigation test below can tell the two
// events' docs apart; every other event id serves the mutable
// `templateResponse` fixture.
const EVT_2_RESPONSE = {
  template: { width_mm: 100, height_mm: 60, dpi: 203, elements: [] },
  version: 7,
};

const server = startMswServer(
  http.get("http://api.test/api/events/:id/badge-template", ({ params }) => {
    fetchCount += 1;
    if (templateStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: templateStatus });
    }
    if (params.id === "evt-2") {
      return HttpResponse.json(EVT_2_RESPONSE);
    }
    return HttpResponse.json(templateResponse);
  }),
  // Task 7's ElementsPane needs `field_schema` (bindings.ts's
  // bindingOptions) — stubbed here (this file only cares about page-level
  // assembly, not ElementsPane's own binding behavior, which
  // ElementsPane.test.tsx owns). Same fixed-shape convention as
  // EventSettingsPage.test.tsx's own /api/events/:id stub.
  http.get("http://api.test/api/events/:id", ({ params }) => HttpResponse.json({
    id: params.id,
    tenant_id: "t1",
    name: "Partner Day",
    field_schema: ["dietary"],
    created_at: "",
    updated_at: "",
  })),
);
void server;

describe("BadgeEditorPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
    fetchCount = 0;
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

  it("does not re-dispatch load over the editor's state when a background refetch returns changed data", async () => {
    templateResponse = { template: null, version: 0 };
    const { queryClient } = renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(canvas.textContent).toMatch(/90/); // parseTemplateDoc(null) defaults loaded

    // Another operator saved meanwhile: a background refetch (window
    // refocus, or a BADGE_TEMPLATE_KEY invalidation) now returns a
    // different template. The page must NOT re-dispatch "load" — that
    // would clobber the operator's in-progress editor state (doc, dirty,
    // selectedId) mid-session. The loaded baseline only ever changes via
    // an explicit reload path (Task 10's conflict handling).
    templateResponse = EVT_2_RESPONSE;
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await waitFor(() => expect(fetchCount).toBe(2));
    // Let any (buggy) re-load dispatch flush before the negative assertion.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    const canvasAfter = screen.getByTestId("badge-pane-canvas");
    expect(canvasAfter.textContent).toMatch(/90/);
    expect(canvasAfter.textContent).not.toMatch(/100/);
  });

  it("re-seeds the editor from the new event's template when navigating to another event", async () => {
    const { router } = renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(canvas.textContent).toMatch(/90/); // evt-1's doc

    // The refetch guard above must be scoped to ONE event — switching to a
    // different event's editor re-seeds from that event's template rather
    // than showing evt-1's stale doc.
    await act(async () => {
      await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });

    await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));
    expect(screen.getByTestId("badge-pane-canvas").textContent).not.toMatch(/90/);
  });

  it("mounts the real BadgeCanvas artboard (not the empty-state guidance) once the template already has elements", async () => {
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
    expect(screen.getByTestId("badge-canvas-artboard")).toBeInTheDocument();
    expect(screen.getByTestId("badge-canvas-element-el-1")).toBeInTheDocument();
  });

  it("wires BadgeCanvas selection into the shared reducer, in sync with ElementsPane", async () => {
    templateResponse = {
      template: {
        width_mm: 90,
        height_mm: 55,
        dpi: 300,
        elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "Hi" }],
      },
      version: 2,
    };
    renderPage();

    const canvasElement = await screen.findByTestId("badge-canvas-element-el-1");
    fireEvent.click(canvasElement);

    // Same selection state now shown on the ElementsPane row (aria-current)
    // -- proves the page wires BOTH panes to the SAME `state.selectedId`,
    // not two independently-tracked selections. Scoped to the elements
    // pane: the canvas element ALSO renders the literal text "Hi".
    const elementsPane = screen.getByTestId("badge-pane-elements");
    const row = within(elementsPane).getByText("Hi").closest("button");
    expect(row).toHaveAttribute("aria-current", "true");
  });
});
