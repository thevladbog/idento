// P5.3.3 Task 2 -- Skeleton previously rendered a plain, unannounced <div>:
// a screen-reader user watching a loading placeholder got no signal that
// content was pending (WCAG 4.1.3, Status Messages). Gains role="status"
// plus a default accessible name, overridable via the standard `aria-label`
// prop -- same convention NumberInput's decrementLabel/incrementLabel
// already establishes (an English default, no i18n dependency, since
// @idento/ui carries none by design).
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("announces a loading state (WCAG 4.1.3)", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has a default accessible name of 'Loading'", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("accepts a caller-supplied accessible name, overriding the default", () => {
    render(<Skeleton aria-label="Loading attendees" />);
    expect(screen.getByRole("status", { name: "Loading attendees" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument();
  });

  it("still renders a pulsing token-based placeholder (unaffected by the a11y additions)", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstChild).toHaveClass("animate-pulse", "bg-muted");
  });
});
