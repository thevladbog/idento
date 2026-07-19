import { render, screen } from "@testing-library/react";
import { STATUS_PILL_STATUSES, StatusPill } from "./status-pill";

describe("StatusPill", () => {
  it.each(STATUS_PILL_STATUSES)("renders %s with an icon and visible text", (status) => {
    const { container } = render(<StatusPill status={status} label={`label-${status}`} />);
    expect(screen.getByText(`label-${status}`)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("covers all six board-1a statuses", () => {
    expect(STATUS_PILL_STATUSES).toEqual(["ready", "in_progress", "empty", "optional", "live", "error"]);
  });

  it("tags the element with its status for styling hooks", () => {
    render(<StatusPill status="live" label="Live" />);
    expect(screen.getByText("Live").closest("span")).toHaveAttribute("data-status", "live");
  });

  it("applies animate-spin class only to in_progress status icon", () => {
    const { container: inProgressContainer } = render(<StatusPill status="in_progress" label="In Progress" />);
    const inProgressIcon = inProgressContainer.querySelector("svg");
    expect(inProgressIcon).toHaveClass("animate-spin");

    const { container: readyContainer } = render(<StatusPill status="ready" label="Ready" />);
    const readyIcon = readyContainer.querySelector("svg");
    expect(readyIcon).not.toHaveClass("animate-spin");
  });

  // PR #81 bot round Finding C1: panel's live-monitor header hand-rolled a
  // pulsing-dot LIVE pill (SaveStatePill's own precedent -- Fix 5, an
  // earlier bot round -- shows the house convention: rebuild ON TOP of this
  // primitive rather than leave local markup). The dot variant didn't exist
  // here yet, so it's added as a small additive API rather than the panel
  // reimplementing it a second time.
  describe("indicator=\"dot\"", () => {
    it("renders a status-colored dot instead of the icon, with no svg present", () => {
      const { container } = render(<StatusPill status="ready" label="Live" indicator="dot" />);
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector(".rounded-full.bg-success")).not.toBeNull();
    });

    it("omits the animated ping ring when pulse is false (the default)", () => {
      const { container } = render(<StatusPill status="ready" label="Live" indicator="dot" />);
      expect(container.querySelector(".animate-ping")).toBeNull();
    });

    it("adds an animated ping ring, colored to match the status, when pulse is true", () => {
      const { container } = render(<StatusPill status="ready" label="Live" indicator="dot" pulse />);
      const ring = container.querySelector(".animate-ping");
      expect(ring).not.toBeNull();
      expect(ring).toHaveClass("bg-success");
    });

    it("still renders the label text alongside the dot (WCAG 1.4.1 -- never color alone)", () => {
      render(<StatusPill status="error" label="Connection lost" indicator="dot" pulse />);
      expect(screen.getByText("Connection lost")).toBeInTheDocument();
    });

    it("colors the dot to match a non-success status (e.g. error -> destructive)", () => {
      const { container } = render(<StatusPill status="error" label="Down" indicator="dot" />);
      expect(container.querySelector(".rounded-full.bg-destructive")).not.toBeNull();
    });
  });
});
