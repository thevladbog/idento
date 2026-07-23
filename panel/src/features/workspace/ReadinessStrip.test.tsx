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
  it("renders one chip per step with label, count and an sr-only status", () => {
    render(<ReadinessStrip steps={STEPS} />);
    const strip = screen.getByTestId("readiness-strip");
    expect(within(strip).getByText("Attendees")).toBeInTheDocument();
    expect(within(strip).getByText("340")).toBeInTheDocument();
    expect(within(strip).getByText("Done")).toHaveClass("sr-only");
    expect(within(strip).getByText("Not done")).toHaveClass("sr-only");
    expect(within(strip).getByText("Skipped")).toHaveClass("sr-only");
  });

  it("renders nothing without steps", () => {
    render(<ReadinessStrip steps={undefined} />);
    expect(screen.queryByTestId("readiness-strip")).not.toBeInTheDocument();
  });
});
