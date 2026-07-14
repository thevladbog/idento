import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { RegisterScreen } from "./RegisterScreen";
import { getCurrentTenant } from "../../shared/api/session";
import "../../shared/i18n";

// RegisterScreen now renders `Link` for in-app navigation, which needs a
// router context to resolve hrefs. These tests exercise form submission, not
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

describe("RegisterScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("submits org name, email, password and saves the session on success", async () => {
    // openapi-fetch (Task 10) reads `.headers`/`.clone()` off the fetch
    // Response, so the mock needs a real Response instance, and it calls the
    // global fetch as `fetch(request: Request, init)` rather than
    // `fetch(url, init)`.
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            token: "tok-1",
            user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
            tenants: [{ id: "t1", name: "Acme Events" }],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    const user = userEvent.setup();
    renderWithQuery(<RegisterScreen />);

    await user.type(screen.getByLabelText("Organization name"), "Acme Events");
    await user.type(screen.getByLabelText("Work email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "secretpw");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(getCurrentTenant()?.name).toBe("Acme Events"));
    const req = (fetch as unknown as { mock: { calls: [Request, unknown][] } }).mock.calls[0][0];
    expect(req.url).toBe("http://api.test/auth/register");
    expect(await req.clone().text()).toBe(
      JSON.stringify({ tenant_name: "Acme Events", email: "a@b.com", password: "secretpw" }),
    );
  });
});
