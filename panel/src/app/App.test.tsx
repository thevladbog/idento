import { render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
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

  it("overrides Sonner's success palette with semantic success tokens", async () => {
    render(<App />);

    toast.success("Success");
    await waitFor(() => expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull());

    const toaster = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    expect(toaster).not.toBeNull();
    expect(toaster?.style.getPropertyValue("--success-bg")).toBe("var(--success)");
    expect(toaster?.style.getPropertyValue("--success-border")).toBe("var(--success)");
    expect(toaster?.style.getPropertyValue("--success-text")).toBe("var(--success-foreground)");
  });

  it("exposes a configured router with the protected layout route", () => {
    expect(router.routeTree.children).toBeDefined();
  });
});
