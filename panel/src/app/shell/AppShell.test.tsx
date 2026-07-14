import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { saveSession } from "../../shared/api/session";
import type { AuthResponse } from "../../shared/api/types";
import { ThemeProvider } from "../../shared/theme/ThemeProvider";
import "../../shared/i18n";

// AppShell renders `Link` (directly, and via NavDrawer) for in-app
// navigation, which needs a router context to resolve hrefs. These tests
// exercise the shell's own rendering, not routing, so a minimal single-route
// router is enough to satisfy that context — same pattern as
// LoginScreen.test.tsx from Task 7.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

const AUTH: AuthResponse = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme Events" }],
  current_tenant: { id: "t1", name: "Acme Events" },
};

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    saveSession(AUTH);
  });

  it("renders the nav links and the children content, no ON-PREM tag on saas", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ mode: "saas", version: "1.0", license: null }),
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterContextProvider router={testRouter}>
            <AppShell>
              <div>page content</div>
            </AppShell>
          </RouterContextProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Equipment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organization" })).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByText(/ON-PREM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/impersonat/i)).not.toBeInTheDocument();
  });

  it("shows the ON-PREM version tag when the instance is on-prem", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ mode: "onprem", version: "2.4.1", license: null }),
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterContextProvider router={testRouter}>
            <AppShell>
              <div>page content</div>
            </AppShell>
          </RouterContextProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("ON-PREM · v2.4.1")).toBeInTheDocument();
  });
});
