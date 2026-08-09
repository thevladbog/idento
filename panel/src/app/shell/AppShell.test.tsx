import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AppShell } from "./AppShell";
import type { components } from "../../shared/api/schema";
import { saveSession } from "../../shared/api/session";
import type { AuthResponse } from "../../shared/api/types";
import { ThemeProvider } from "../../shared/theme/ThemeProvider";
import { startMswServer } from "../../test/msw";
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

type TenantMembership = components["schemas"]["TenantMembership"];
let tenantRole: TenantMembership["role"] = "admin";
let tenantStatus = 200;
let tenantRequestCount = 0;

// AppShell mounts both the instance query and one live active-tenant query.
// Default to saas/admin; individual tests override either response.
const server = startMswServer(
  http.get("http://api.test/api/instance", () =>
    HttpResponse.json({ mode: "saas", version: "1.0", license: null }),
  ),
  http.get("http://api.test/api/tenants/:id", () => {
    tenantRequestCount += 1;
    if (tenantStatus !== 200) return new HttpResponse(null, { status: tenantStatus });
    return HttpResponse.json({
      id: "t1",
      name: "Acme Events",
      role: tenantRole,
      settings: null,
      logo_url: null,
      website: null,
      contact_email: null,
      created_at: "",
      updated_at: "",
    });
  }),
);

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterContextProvider router={testRouter}>
          <AppShell><div>page content</div></AppShell>
        </RouterContextProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    saveSession(AUTH);
    tenantRole = "admin";
    tenantStatus = 200;
    tenantRequestCount = 0;
  });

  it("renders the nav links and the children content, no ON-PREM tag on saas", () => {
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

  it("renders the Idento brand mark in the header", () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterContextProvider router={testRouter}>
            <AppShell><div>page content</div></AppShell>
          </RouterContextProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(container.querySelector('img[src="/logo-mark.svg"]')).not.toBeNull();
  });

  it("shows the ON-PREM version tag when the instance is on-prem", async () => {
    server.use(
      http.get("http://api.test/api/instance", () =>
        HttpResponse.json({ mode: "onprem", version: "2.4.1", license: null }),
      ),
    );
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

  it("shows My profile in desktop and drawer navigation for the live staff role", async () => {
    tenantRole = "staff";
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByRole("link", { name: "My profile" })).not.toBeInTheDocument();
    const desktopLink = await screen.findByRole("link", { name: "My profile" });
    expect(desktopLink).toHaveAttribute("href", "/me");

    await user.click(screen.getByRole("button", { name: "Menu" }));
    await waitFor(() => expect(screen.getAllByText("My profile")).toHaveLength(2));
    const profileLabels = screen.getAllByText("My profile");
    expect(profileLabels[1].closest("a")).toHaveAttribute("href", "/me");
  });

  it.each(["admin", "manager"] satisfies TenantMembership["role"][])(
    "hides My profile for the live %s role",
    async (role) => {
      tenantRole = role;
      const queryClient = renderShell();

      await waitFor(() => expect(tenantRequestCount).toBe(1));
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(screen.queryByRole("link", { name: "My profile" })).not.toBeInTheDocument();
    },
  );

  it("hides My profile when the live tenant request fails", async () => {
    tenantStatus = 500;
    const queryClient = renderShell();

    await waitFor(() => expect(tenantRequestCount).toBe(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole("link", { name: "My profile" })).not.toBeInTheDocument();
  });

  it("hides My profile and skips the role request when there is no active tenant", async () => {
    saveSession({ ...AUTH, tenants: [], current_tenant: null });
    const queryClient = renderShell();

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(tenantRequestCount).toBe(0);
    expect(screen.queryByRole("link", { name: "My profile" })).not.toBeInTheDocument();
  });
});
