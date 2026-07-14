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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        token: "tok-1",
        user: { id: "u2", tenant_id: "t1", email: "staff@b.com", role: "staff", created_at: "", updated_at: "" },
      }),
    });
    const user = userEvent.setup();
    renderWithQuery(<QrLoginScreen />);

    await user.type(screen.getByLabelText("Code"), "QR-4471");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(getCurrentUser()?.role).toBe("staff"));
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/auth/login-qr",
      expect.objectContaining({ body: JSON.stringify({ qr_token: "QR-4471" }) }),
    );
  });
});
