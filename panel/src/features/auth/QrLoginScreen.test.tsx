import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QrLoginScreen } from "./QrLoginScreen";
import { getCurrentUser } from "../../shared/api/session";
import "../../shared/i18n";

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("QrLoginScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("submits the manually entered code and saves the session on success", async () => {
    // openapi-fetch (Task 10) reads `.headers`/`.clone()` off the fetch
    // Response, so the mock needs a real Response instance, and it calls the
    // global fetch as `fetch(request: Request, init)` rather than
    // `fetch(url, init)`.
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            token: "tok-1",
            user: { id: "u2", tenant_id: "t1", email: "staff@b.com", role: "staff", created_at: "", updated_at: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const user = userEvent.setup();
    renderWithQuery(<QrLoginScreen />);

    await user.type(screen.getByLabelText("Code"), "QR-4471");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(getCurrentUser()?.role).toBe("staff"));
    const req = (fetch as unknown as { mock: { calls: [Request, unknown][] } }).mock.calls[0][0];
    expect(req.url).toBe("http://api.test/auth/login-qr");
    expect(await req.clone().text()).toBe(JSON.stringify({ qr_token: "QR-4471" }));
  });
});
