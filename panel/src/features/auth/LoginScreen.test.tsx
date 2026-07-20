import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { LoginScreen } from "./LoginScreen";
import { getCurrentUser } from "../../shared/api/session";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// LoginScreen now renders `Link` for in-app navigation, which needs a router
// context to resolve hrefs. These tests exercise form submission, not
// routing, so a minimal single-route router is enough to satisfy that context.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

// LoginScreen fires useInstance's GET /api/instance on mount; the login POST
// is added per-test via server.use() since its response differs per case.
const server = startMswServer(
  http.get("http://api.test/api/instance", () =>
    HttpResponse.json({ mode: "saas", version: "test", license: null }),
  ),
);

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
    server.use(
      http.post("http://api.test/auth/login", () =>
        HttpResponse.json({
          token: "tok-1",
          user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
          tenants: [{ id: "t1", name: "Acme" }],
          current_tenant: { id: "t1", name: "Acme" },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<LoginScreen />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(getCurrentUser()?.email).toBe("a@b.com"));
  });

  it("shows the Idento brand mark", () => {
    renderWithQuery(<LoginScreen />);
    expect(screen.getByRole("img", { name: "Idento" })).toBeInTheDocument();
  });

  it("shows an error message when the backend rejects the credentials", async () => {
    server.use(
      http.post("http://api.test/auth/login", () =>
        HttpResponse.json({ error: "Invalid credentials" }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<LoginScreen />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Incorrect email/code or password. Please try again.")).toBeInTheDocument();
  });
});
