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
});
