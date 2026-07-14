import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrgSwitcher } from "./OrgSwitcher";
import { saveSession } from "../../shared/api/session";
import type { AuthResponse } from "../../shared/api/types";

const AUTH: AuthResponse = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme Events" }, { id: "t2", name: "Beta Org" }],
  current_tenant: { id: "t1", name: "Acme Events" },
};

describe("OrgSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
    saveSession(AUTH);
  });

  it("lists every tenant and switches on selection", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token: "tok-2", current_tenant: AUTH.tenants[1] }),
    });
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrgSwitcher />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Acme Events/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Beta Org" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "http://api.test/api/auth/switch-tenant",
        expect.objectContaining({ body: JSON.stringify({ tenant_id: "t2" }) }),
      ),
    );
  });
});
