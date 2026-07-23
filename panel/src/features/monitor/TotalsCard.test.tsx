// P6.2 Task 3 -- TotalsCard's own unit tests (board 8f: XXL phone headline +
// a spread three-part rate row, `md:` restoring board 7e's desktop scale).
// Previously this card was only exercised indirectly through
// MonitorPage.test.tsx's full-page harness; this file adds a focused
// component-level test using the same bare-`render` idiom
// ReadinessCell.test.tsx already establishes for a presentational card that
// needs no QueryClient/router (TotalsCard takes its `totals` prop directly,
// no data-fetching of its own).
import { render, screen, within } from "@testing-library/react";
import { TotalsCard } from "./TotalsCard";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

type MonitorTotals = components["schemas"]["MonitorTotals"];

// All three rate-row segments present (rate/peak/est-done) so the "3
// separate spans" assertion below actually exercises every part, not just
// the always-present rate segment.
const TOTALS_FIXTURE: MonitorTotals = {
  checked_in: 1284,
  total: 2410,
  rate_per_min: 8.2,
  peak: { rate: 14.6, at: "2026-07-18T09:40:00Z" },
  est_done_at: "2026-07-18T12:20:00Z",
};

describe("TotalsCard", () => {
  it("renders the rate parts as separate spans in the rate row", () => {
    render(<TotalsCard totals={TOTALS_FIXTURE} />);

    const row = screen.getByTestId("monitor-rate-row");
    expect(row.children.length).toBe(3);
    expect(within(row).getByText(/min/)).toBeInTheDocument();
  });

  it("keeps the XXL phone sizing classes on the headline number", () => {
    render(<TotalsCard totals={TOTALS_FIXTURE} />);

    const headline = screen.getByTestId("monitor-totals-headline");
    expect(headline).toHaveClass("text-5xl", "md:text-2xl");
  });
});
