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

  // PR #81 round-2 convergence Finding 5: StationsCard.tsx's per-station
  // liveness dot needs the SAME status-colored dot as indicator="dot" above,
  // but with NO pill chrome (border/background/padding) and NO always-
  // visible label -- the row around it already supplies its own name and a
  // SEPARATE, conditional text label (e.g. "stale 40 s", rendered only while
  // stale; nothing renders at all while fresh). Added as `variant="bare"`
  // rather than the panel hand-rolling a dot a second time.
  describe("variant=\"bare\"", () => {
    it("renders only the status-colored dot -- no pill chrome, no visible label text, no icon", () => {
      const { container } = render(<StatusPill status="ready" label="Fresh" variant="bare" />);
      expect(screen.queryByText("Fresh")).not.toBeInTheDocument();
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector(".rounded-full.bg-success")).not.toBeNull();
      // No pill chrome (border/background/padding) anywhere in the tree.
      expect(container.querySelector(".border")).toBeNull();
      expect(container.querySelector(".px-2\\.5")).toBeNull();
    });

    it("exposes the label via aria-label, since no visible text is rendered", () => {
      render(<StatusPill status="in_progress" label="Stale 40 s" variant="bare" />);
      expect(screen.getByLabelText("Stale 40 s")).toBeInTheDocument();
    });

    it("colors the dot to match the given status (e.g. in_progress -> warning)", () => {
      const { container } = render(<StatusPill status="in_progress" label="Stale" variant="bare" />);
      expect(container.querySelector(".rounded-full.bg-warning")).not.toBeNull();
    });

    it("omits the animated ping ring when pulse is false (the default)", () => {
      const { container } = render(<StatusPill status="ready" label="Fresh" variant="bare" />);
      expect(container.querySelector(".animate-ping")).toBeNull();
    });

    it("adds an animated ping ring, colored to match the status, when pulse is true", () => {
      const { container } = render(<StatusPill status="ready" label="Fresh" variant="bare" pulse />);
      const ring = container.querySelector(".animate-ping");
      expect(ring).not.toBeNull();
      expect(ring).toHaveClass("bg-success");
    });

    it("applies a caller className on the root element (e.g. sizing overrides)", () => {
      const { container } = render(
        <StatusPill status="ready" label="Fresh" variant="bare" className="my-marker-class" />,
      );
      expect(container.querySelector(".my-marker-class")).not.toBeNull();
    });
  });
});
