import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { RegisterScreen } from "./RegisterScreen";
import { getCurrentTenant } from "../../shared/api/session";
import "../../shared/i18n";

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("RegisterScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("submits org name, email, password and saves the session on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({
        token: "tok-1",
        user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
        tenants: [{ id: "t1", name: "Acme Events" }],
      }),
    });
    const user = userEvent.setup();
    renderWithQuery(<RegisterScreen />);

    await user.type(screen.getByLabelText("Organization name"), "Acme Events");
    await user.type(screen.getByLabelText("Work email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "secretpw");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(getCurrentTenant()?.name).toBe("Acme Events"));
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/auth/register",
      expect.objectContaining({
        body: JSON.stringify({ tenant_name: "Acme Events", email: "a@b.com", password: "secretpw" }),
      }),
    );
  });
});
