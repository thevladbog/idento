import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { EventWorkspaceLayout } from "./EventWorkspaceLayout";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Isolated route tree matching the real app's shape closely enough for
// `EventWorkspaceLayout`'s `getRouteApi("/_app/events/$eventId").useParams()`
// and the rail's `active` derivation (from the current pathname) to resolve
// — same rationale as the deleted EventWorkspaceStub.test.tsx's harness.
// The child routes use throwaway marker components rather than the real
// Task 3/4 placeholders: this test only owns the layout's job of rendering
// the header/rail/Outlet, not the placeholder copy those routes show.
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const homeRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/", component: () => <div>home content</div> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: EventWorkspaceLayout,
  });
  const overviewRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/",
    component: () => <div>overview content</div>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/settings",
    component: () => <div>settings content</div>,
  });
  const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([homeRoute, workspaceRoute.addChildren([overviewRoute, settingsRoute])]),
  ]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton (./router.tsx via module
          augmentation) — same rationale as ProtectedLayout.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

const READY_TRUE = { ready: true, steps: [{ key: "attendees", status: "done", count: 340 }] };
const READY_FALSE = { ready: false, steps: [{ key: "attendees", status: "not_done" }] };

let readinessResponse: unknown = READY_FALSE;

const server = startMswServer(
  http.get("http://api.test/api/events/:id", ({ params }) => {
    if (params.id === "evt-missing") {
      return HttpResponse.json({ error: "not found" }, { status: 404 });
    }
    return HttpResponse.json({
      id: params.id,
      tenant_id: "t1",
      name: "Partner Day — Autumn",
      start_date: "2026-09-03T00:00:00.000Z",
      created_at: "",
      updated_at: "",
    });
  }),
  http.get("http://api.test/api/events/:id/readiness", () => HttpResponse.json(readinessResponse)),
);
void server;

describe("EventWorkspaceLayout", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    readinessResponse = READY_FALSE;
  });

  it("renders the event name, the rail, and the matched child route's outlet content", async () => {
    renderAt("/events/evt-1");

    expect(await screen.findByRole("heading", { name: "Partner Day — Autumn" })).toBeInTheDocument();
    expect(screen.getByText("overview content")).toBeInTheDocument();
    // Rail is mounted (Task 1 component) — its static Settings nav item is
    // present, and Overview is marked active for the index route.
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("marks Settings active in the rail and renders the settings child route's outlet content", async () => {
    renderAt("/events/evt-1/settings");

    expect(await screen.findByRole("heading", { name: "Partner Day — Autumn" })).toBeInTheDocument();
    expect(screen.getByText("settings content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("disables the launch-check-in button with a discoverable locked reason when the event isn't ready", async () => {
    readinessResponse = READY_FALSE;
    renderAt("/events/evt-1");

    await screen.findByRole("heading", { name: "Partner Day — Autumn" });
    // WCAG 1.4.1: the locked state must be discoverable via text, not just
    // the padlock icon/dimming — the accessible name carries both the label
    // and the "locked" reason.
    const button = await screen.findByRole("button", { name: "Launch check-in locked" });
    expect(button).toBeDisabled();
  });

  it("enables the launch-check-in button and opens the coming-soon dialog when the event is ready", async () => {
    readinessResponse = READY_TRUE;
    renderAt("/events/evt-1");

    await screen.findByRole("heading", { name: "Partner Day — Autumn" });
    const button = await screen.findByRole("button", { name: "Launch check-in" });
    expect(button).toBeEnabled();

    button.click();

    expect(await screen.findByText("Launch ceremony arrives with the check-in station")).toBeInTheDocument();
    expect(
      screen.getByText("Confirming the event, loading station settings and the printer check land in a later update."),
    ).toBeInTheDocument();
  });

  it("renders the load-error message and a back-Home link when the event fetch fails", async () => {
    renderAt("/events/evt-missing");

    expect(await screen.findByText("Couldn't load this event.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Back to Home/ });
    expect(link).toHaveAttribute("href", "/");
    await waitFor(() => expect(screen.queryByRole("heading")).not.toBeInTheDocument());
  });
});
