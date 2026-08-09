import { render, screen, within } from "@testing-library/react";
import { ReadinessStrip } from "./ReadinessStrip";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type ReadinessStep = components["schemas"]["ReadinessStep"];

const STEPS: ReadinessStep[] = [
  { key: "attendees", status: "done", count: 340 },
  { key: "badge", status: "not_done" },
  { key: "zones", status: "skipped" },
];

describe("ReadinessStrip", () => {
  it("renders each localized status visibly in the same chip as its status icon", () => {
    render(<ReadinessStrip steps={STEPS} />);
    const strip = screen.getByTestId("readiness-strip");
    const attendeesChip = within(strip).getByText("Attendees");
    expect(attendeesChip.querySelector("svg")).toBeInTheDocument();
    expect(within(strip).getByText("340")).toBeInTheDocument();
    for (const status of ["Done", "Not done", "Skipped"]) {
      const statusText = within(strip).getByText(status);
      expect(statusText).toBeVisible();
      expect(statusText).not.toHaveClass("sr-only");
      expect(statusText.parentElement?.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("contains overflow in a bounded outer layer while the inner row scrolls", () => {
    render(<ReadinessStrip steps={STEPS} />);
    const outer = screen.getByTestId("readiness-strip");
    const scroller = screen.getByTestId("readiness-strip-scroller");
    expect(outer).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(scroller).toHaveClass("min-w-0", "max-w-full", "overflow-x-auto");
  });

  it("renders nothing without steps", () => {
    render(<ReadinessStrip steps={undefined} />);
    expect(screen.queryByTestId("readiness-strip")).not.toBeInTheDocument();
  });
});
