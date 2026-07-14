import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { router } from "./router";

describe("App", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });

  it("renders the root route inside the router and query providers", async () => {
    render(<App />);
    expect(await screen.findByText("Idento Panel")).toBeInTheDocument();
  });

  it("exposes a configured router with the index route", () => {
    expect(router.routeTree.children).toBeDefined();
  });
});
