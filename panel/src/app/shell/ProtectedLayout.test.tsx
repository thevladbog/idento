import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { ProtectedLayout } from "./ProtectedLayout";
import { clearSession, saveSession } from "../../shared/api/session";
import type { AuthResponse } from "../../shared/api/types";
import { ThemeProvider } from "../../shared/theme/ThemeProvider";
import "../../shared/i18n";

const AUTH: AuthResponse = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme Events" }],
  current_tenant: { id: "t1", name: "Acme Events" },
};

function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const layoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: ProtectedLayout });
  const homeRoute = createRoute({ getParentRoute: () => layoutRoute, path: "/", component: () => <div>home content</div> });
  const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: () => <div>login page</div> });
  const routeTree = rootRoute.addChildren([layoutRoute.addChildren([homeRoute]), loginRoute]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

describe("ProtectedLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ mode: "saas", version: "1.0", license: null }),
    });
  });

  it("redirects to /login when there is no session", async () => {
    clearSession();
    const router = buildRouter("/");
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {/* Cast, not @ts-expect-error: this test router has a different
              route shape than the app's registered singleton (./router.tsx),
              so its type won't structurally match RouterProvider's globally
              registered Router type — an assertion is the safe way to bypass
              that without depending on there being exactly one type error. */}
          <RouterProvider router={router as never} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("login page")).toBeInTheDocument());
  });

  it("renders the outlet content when a session exists", async () => {
    saveSession(AUTH);
    const router = buildRouter("/");
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {/* Cast, not @ts-expect-error: this test router has a different
              route shape than the app's registered singleton (./router.tsx),
              so its type won't structurally match RouterProvider's globally
              registered Router type — an assertion is the safe way to bypass
              that without depending on there being exactly one type error. */}
          <RouterProvider router={router as never} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("home content")).toBeInTheDocument());
  });
});
