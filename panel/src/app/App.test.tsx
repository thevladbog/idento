import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { router } from "./router";
import { clearSession } from "../shared/api/session";
import "../shared/i18n";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    clearSession();
    window.__ENV__ = { API_URL: "http://api.test" };
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });

  it("redirects an unauthenticated visitor to the login screen", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("exposes a configured router with the protected layout route", () => {
    expect(router.routeTree.children).toBeDefined();
  });
});
