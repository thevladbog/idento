import { render, screen } from "@testing-library/react";
import { ImpersonationBanner } from "./ImpersonationBanner";
import "../../shared/i18n";

describe("ImpersonationBanner", () => {
  beforeEach(() => localStorage.clear());

  it("renders nothing when there is no active impersonation session", () => {
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the tenant name and an End session button when a session is active", () => {
    localStorage.setItem(
      "impersonation",
      JSON.stringify({
        tenantId: "t1",
        tenantName: "Acme Events",
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        mintedAt: new Date().toISOString(),
      }),
    );
    render(<ImpersonationBanner />);
    expect(screen.getByText(/Acme Events/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
  });
});
