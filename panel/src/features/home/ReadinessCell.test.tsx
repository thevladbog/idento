import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReadinessCell } from "./ReadinessCell";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type EventReadinessResponse = components["schemas"]["EventReadinessResponse"];

const progressReadiness: EventReadinessResponse = {
  ready: false,
  steps: [
    { key: "attendees", status: "done", count: 10 },
    { key: "badge", status: "not_done" },
    { key: "zones", status: "skipped" },
    { key: "staff", status: "done" },
    { key: "equipment", status: "not_done" },
  ],
};

// P4.3 Task 7 regression: the equipment readiness step was a backend stub
// (always "not_done") through P4.2 -- Task 4 wired the real
// TenantHasTestedDefaultPrinter-backed computation, so "done" is now a
// reachable status for this key. STEP_LABEL_KEYS/the tooltip's generic
// per-step renderer already handled "equipment" as a key (P1.2) -- this
// pins that the EXISTING generic renderer, unmodified, correctly renders
// the newly-reachable "done" status for it, exactly like every other step.
const equipmentDoneReadiness: EventReadinessResponse = {
  ready: false,
  steps: [
    { key: "attendees", status: "done", count: 10 },
    { key: "badge", status: "not_done" },
    { key: "zones", status: "skipped" },
    { key: "staff", status: "done" },
    { key: "equipment", status: "done" },
  ],
};

const draftReadiness: EventReadinessResponse = {
  ready: false,
  steps: [
    { key: "attendees", status: "not_done" },
    { key: "badge", status: "not_done" },
    { key: "zones", status: "skipped" },
    { key: "staff", status: "not_done" },
    { key: "equipment", status: "not_done" },
  ],
};

describe("ReadinessCell", () => {
  it("renders a sized skeleton while readiness is loading", () => {
    const { container } = render(<ReadinessCell readiness={undefined} />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders a 5-segment bar with success/muted segments and the ready fraction when there's progress", () => {
    render(<ReadinessCell readiness={progressReadiness} />);

    // 2 done ("attendees", "staff") out of 4 non-skipped steps.
    expect(screen.getByText("2 of 4 ready")).toBeInTheDocument();

    const segments = document.querySelectorAll("[data-readiness-segment]");
    expect(segments).toHaveLength(5);
    const statuses = [...segments].map((el) => el.getAttribute("data-readiness-segment"));
    expect(statuses).toEqual(["done", "not_done", "skipped", "done", "not_done"]);

    const doneSegments = document.querySelectorAll('[data-readiness-segment="done"]');
    doneSegments.forEach((el) => expect(el).toHaveClass("bg-success"));
    const restSegments = document.querySelectorAll(
      '[data-readiness-segment="not_done"], [data-readiness-segment="skipped"]',
    );
    restSegments.forEach((el) => expect(el).toHaveClass("bg-muted"));
  });

  // P4.3 Task 7 regression (spec §5.5): a readiness payload where the
  // "equipment" step is "done" renders that segment as done (bg-success),
  // and its tooltip row shows "(Done)" -- the SAME generic step renderer
  // that already handled "not_done"/"skipped" for this key, unmodified.
  it("renders the equipment step as done (segment + tooltip) when its status is 'done', not_done rendering as before for the other steps", () => {
    render(<ReadinessCell readiness={equipmentDoneReadiness} />);

    // 3 done ("attendees", "staff", "equipment") out of 4 non-skipped steps.
    expect(screen.getByText("3 of 4 ready")).toBeInTheDocument();

    const segments = document.querySelectorAll("[data-readiness-segment]");
    const statuses = [...segments].map((el) => el.getAttribute("data-readiness-segment"));
    expect(statuses).toEqual(["done", "not_done", "skipped", "done", "done"]);
    expect(segments[4]).toHaveClass("bg-success");
    // "badge" is still "not_done" -- unaffected by the equipment change.
    expect(segments[1]).toHaveClass("bg-muted");
  });

  it("renders a neutral Draft status pill instead of the bar when no step is done yet", () => {
    render(<ReadinessCell readiness={draftReadiness} />);

    const pill = screen.getByText("Draft");
    expect(pill.closest('[data-status="optional"]')).toBeInTheDocument();
    expect(screen.queryByText(/ready/)).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-readiness-segment]")).toHaveLength(0);
  });

  it("shows a per-step tooltip breakdown (label + status) on focus", async () => {
    render(<ReadinessCell readiness={progressReadiness} />);

    const trigger = screen.getByRole("button");
    fireEvent.focus(trigger);

    // Radix renders the tooltip's text twice (a visible popper copy plus a
    // visually-hidden role="tooltip" copy for assistive tech) — scope
    // queries to the accessible copy to avoid duplicate-match errors.
    const tooltip = within(await screen.findByRole("tooltip"));
    expect(tooltip.getByText("Attendees")).toBeInTheDocument();
    expect(tooltip.getByText("Badge")).toBeInTheDocument();
    expect(tooltip.getByText("Zones")).toBeInTheDocument();
    expect(tooltip.getByText("Staff")).toBeInTheDocument();
    expect(tooltip.getByText("Equipment")).toBeInTheDocument();

    // Every status gets a real text annotation next to its label, not just
    // "skipped" — status must never be conveyed by icon/color alone (WCAG
    // 1.4.1). "attendees" is done, "badge" is not_done, and "zones" is
    // skipped in this fixture, so scope each assertion to its own row (the
    // fixture has two "done" and two "not_done" steps, so the status text
    // repeats and can't be queried unscoped).
    const attendeesRow = tooltip.getByText("Attendees").closest("li");
    expect(attendeesRow).not.toBeNull();
    expect(within(attendeesRow as HTMLElement).getByText("(Done)")).toBeInTheDocument();

    const badgeRow = tooltip.getByText("Badge").closest("li");
    expect(badgeRow).not.toBeNull();
    expect(within(badgeRow as HTMLElement).getByText("(Not done)")).toBeInTheDocument();

    const zonesRow = tooltip.getByText("Zones").closest("li");
    expect(zonesRow).not.toBeNull();
    expect(within(zonesRow as HTMLElement).getByText("(Skipped)")).toBeInTheDocument();
  });
});
