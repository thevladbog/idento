import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { EventSettingsPage } from "./EventSettingsPage";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";

// jsdom has no IntersectionObserver (see useScrollSpy.test.ts) and panel's
// global test/setup.ts intentionally doesn't stub one — this page mounts
// the real useScrollSpy hook, so without a stub its rAF-retry loop throws
// once the section elements exist. A minimal no-op stub is enough: these
// tests don't exercise scroll-spy activation itself (useScrollSpy.test.ts
// owns that), just that the page renders without it blowing up.
class NoopIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Mirrors WorkspaceOverview.test.tsx's harness shape: a throwaway route tree
// whose id/path structure matches the real app closely enough for
// `getRouteApi("/_app/events/$eventId").useParams()` to resolve.
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/settings",
    component: EventSettingsPage,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([settingsRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton — same rationale as
          EventWorkspaceLayout.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

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
      end_date: "2026-09-05T00:00:00.000Z",
      location: "Hyatt Regency",
      created_at: "",
      updated_at: "",
    });
  }),
  // FontsCard (mounted in the Fonts section) fetches this for real —
  // stubbed here (this file only cares about page-level assembly, not
  // FontsCard's own behavior, which FontsCard.test.tsx owns).
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  // Same rationale for ApiKeysCard, mounted in the API keys section —
  // ApiKeysCard.test.tsx owns its own behavior.
  http.get("http://api.test/api/events/:eventId/api-keys", () => HttpResponse.json([])),
);
void server;

describe("EventSettingsPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("renders the four anchor sections and matching rail links", async () => {
    renderAt("/events/evt-1/settings");

    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();

    expect(document.getElementById("settings-general")).toBeInTheDocument();
    expect(document.getElementById("settings-fonts")).toBeInTheDocument();
    expect(document.getElementById("settings-api-keys")).toBeInTheDocument();
    expect(document.getElementById("settings-danger")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "#settings-general");
    expect(screen.getByRole("link", { name: "Fonts" })).toHaveAttribute("href", "#settings-fonts");
    expect(screen.getByRole("link", { name: "API keys" })).toHaveAttribute("href", "#settings-api-keys");
    expect(screen.getByRole("link", { name: "Danger zone" })).toHaveAttribute("href", "#settings-danger");
  });

  it("always styles the danger-zone rail link as destructive, regardless of scroll position", async () => {
    renderAt("/events/evt-1/settings");
    await screen.findByRole("heading", { name: "General" });

    const dangerLink = screen.getByRole("link", { name: "Danger zone" });
    expect(dangerLink.className).toContain("text-destructive");

    const generalLink = screen.getByRole("link", { name: "General" });
    expect(generalLink.className).not.toContain("text-destructive");
  });

  it("mounts the real GeneralCard with the loaded event's values inside the General section", async () => {
    renderAt("/events/evt-1/settings");
    await screen.findByRole("heading", { name: "General" });

    expect(screen.getByLabelText("Event name")).toHaveValue("Partner Day — Autumn");
  });

  it("shows a load-error message when the event fetch fails", async () => {
    renderAt("/events/evt-missing/settings");

    expect(await screen.findByText("Couldn't load settings.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "General" })).not.toBeInTheDocument();
  });

  it("shows loading skeletons, not fabricated content, before the event loads", () => {
    renderAt("/events/evt-1/settings");

    expect(screen.queryByRole("heading", { name: "General" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "General" })).not.toBeInTheDocument();
  });
});
