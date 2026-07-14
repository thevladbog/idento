import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { LoginScreen } from "./LoginScreen";
import { getCurrentUser } from "../../shared/api/session";
import "../../shared/i18n";

// LoginScreen now renders `Link` for in-app navigation, which needs a router
// context to resolve hrefs. These tests exercise form submission, not
// routing, so a minimal single-route router is enough to satisfy that context.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  );
}

describe("LoginScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("submits email+password and saves the session on success", async () => {
    // openapi-fetch (Task 10) reads `.headers`/`.clone()` off the fetch
    // Response, so mocks need real Response instances rather than bare
    // `{ok,status,json}` objects. LoginScreen fires two separate fetch calls
    // (useInstance's GET /api/instance on mount, then the login POST on
    // submit) — the mock must route by URL rather than returning the same
    // payload for both, or the mount-time instance query silently receives
    // login-shaped data instead of InstanceInfo.
    global.fetch = vi.fn().mockImplementation((req: Request) => {
      if (req.url.includes("/api/instance")) {
        return new Response(JSON.stringify({ mode: "saas", version: "test", license: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          token: "tok-1",
          user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
          tenants: [{ id: "t1", name: "Acme" }],
          current_tenant: { id: "t1", name: "Acme" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const user = userEvent.setup();
    renderWithQuery(<LoginScreen />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(getCurrentUser()?.email).toBe("a@b.com"));
  });

  it("shows an error message when the backend rejects the credentials", async () => {
    // Same URL-routing reasoning as above: /api/instance must keep
    // succeeding on mount, only /auth/login should 401.
    global.fetch = vi.fn().mockImplementation((req: Request) => {
      if (req.url.includes("/api/instance")) {
        return new Response(JSON.stringify({ mode: "saas", version: "test", license: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });
    const user = userEvent.setup();
    renderWithQuery(<LoginScreen />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Incorrect email/code or password. Please try again.")).toBeInTheDocument();
  });
});
