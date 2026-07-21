// VerdictCard had no dedicated test file before -- coverage was only
// indirect, via StationPage.test.tsx's end-to-end scans. PR #77 bot-review
// round adds a few outcome-specific renderings (Finding H's block_reason,
// Finding I's MarkPrintedError distinction, Finding F's idle requestError)
// that are much more directly proven here, against the real component with
// a hand-built CheckinFlowState, than by round-tripping a whole station.
import { render, screen } from "@testing-library/react";
import { verdictClasses } from "@idento/ui";
import { VerdictCard } from "./VerdictCard";
import type { CheckinFlowState } from "./useCheckinFlow";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type Attendee = components["schemas"]["Attendee"];

const ADA: Attendee = {
  id: "att-1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "CODE1",
  checkin_status: false,
  printed_count: 0,
  blocked: true,
  packet_delivered: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("VerdictCard", () => {
  // PR #77 bot-review round, Finding H -- the blocked outcome (mapped to the
  // "no_access" verdict, verdict.ts's OUTCOME_TO_VERDICT) carries
  // `attendee.block_reason`, but VerdictCard previously rendered name/code
  // for every outcome uniformly -- door staff saw "Access denied" but never
  // WHY, which they need to explain/resolve the denial.
  describe("blocked verdict (block_reason)", () => {
    it("renders attendee.block_reason for the no_access verdict", () => {
      const state: CheckinFlowState = {
        status: "verdict",
        verdict: "no_access",
        attendee: { ...ADA, block_reason: "Denied entry by organizer" },
      };
      render(<VerdictCard state={state} />);

      expect(screen.getByTestId("checkin-block-reason")).toHaveTextContent(
        "Reason: Denied entry by organizer",
      );
    });

    it("renders nothing extra when block_reason is null", () => {
      const state: CheckinFlowState = {
        status: "verdict",
        verdict: "no_access",
        attendee: { ...ADA, block_reason: null },
      };
      render(<VerdictCard state={state} />);

      expect(screen.queryByTestId("checkin-block-reason")).not.toBeInTheDocument();
    });

    it("renders nothing extra when block_reason is an empty string", () => {
      const state: CheckinFlowState = {
        status: "verdict",
        verdict: "no_access",
        attendee: { ...ADA, block_reason: "" },
      };
      render(<VerdictCard state={state} />);

      expect(screen.queryByTestId("checkin-block-reason")).not.toBeInTheDocument();
    });

    it("never renders a block_reason line for a non-blocked verdict, even if the attendee record happens to carry one", () => {
      const state: CheckinFlowState = {
        status: "verdict",
        verdict: "allowed",
        attendee: { ...ADA, block_reason: "stale value from a prior block" },
      };
      render(<VerdictCard state={state} />);

      expect(screen.queryByTestId("checkin-block-reason")).not.toBeInTheDocument();
    });
  });

  // PR #77 bot-review round, Finding I -- a MarkPrintedError (the badge WAS
  // sent, only the /printed counter-update afterward failed) must read as a
  // softer, distinct caveat from a genuine print failure -- telling the
  // operator to reprint would risk an unnecessary duplicate print.
  describe("print state distinction", () => {
    it("shows the mark-printed warning (not the reprint-it copy) when printMarkFailed is set", () => {
      const state: CheckinFlowState = {
        status: "verdict",
        verdict: "allowed",
        attendee: ADA,
        printMarkFailed: { printer: "Zebra_ZD421" },
      };
      render(<VerdictCard state={state} />);

      expect(screen.getByTestId("checkin-print-mark-warning")).toHaveTextContent(
        "Sent to Zebra_ZD421, but the printed count couldn't be updated.",
      );
      expect(screen.queryByText("Badge didn't print — reprint it from the recent scans list.")).not.toBeInTheDocument();
    });

    it("still shows the reprint-it copy for a genuine printError when printMarkFailed is absent", () => {
      const state: CheckinFlowState = {
        status: "verdict",
        verdict: "allowed",
        attendee: ADA,
        printError: new Error("agent unreachable"),
      };
      render(<VerdictCard state={state} />);

      expect(screen.getByText("Badge didn't print — reprint it from the recent scans list.")).toBeInTheDocument();
      expect(screen.queryByTestId("checkin-print-mark-warning")).not.toBeInTheDocument();
    });
  });

  // PR #77 bot-review round, Finding F -- a genuine check-in-request failure
  // (not a print failure) must show SOMETHING to the operator instead of
  // silently going quiet, per the station's core no-scan-lost requirement.
  describe("idle requestError", () => {
    it("shows a visible error on the idle view when requestError is set", () => {
      const state: CheckinFlowState = { status: "idle", requestError: new Error("network down") };
      render(<VerdictCard state={state} />);

      expect(screen.getByTestId("checkin-request-error")).toHaveTextContent(
        "Couldn't complete the check-in. Try scanning again.",
      );
    });

    it("shows the plain idle hint, no error line, when requestError is absent", () => {
      const state: CheckinFlowState = { status: "idle" };
      render(<VerdictCard state={state} />);

      expect(screen.getByText("Ready for the next scan.")).toBeInTheDocument();
      expect(screen.queryByTestId("checkin-request-error")).not.toBeInTheDocument();
    });
  });

  it("still renders the base verdict card correctly (sanity check unaffected by the additions above)", () => {
    const state: CheckinFlowState = { status: "verdict", verdict: "allowed", attendee: ADA };
    render(<VerdictCard state={state} />);

    const card = screen.getByTestId("checkin-verdict-card");
    expect(card).toHaveAttribute("data-verdict", "allowed");
    expect(card.className).toContain(verdictClasses.allowed.bg);
  });

  // P5.3.3 Task 2 -- the settled verdict is the single most important thing
  // a screen-reader-using door-staff operator needs announced the instant a
  // scan resolves (WCAG 4.1.3, Status Messages); without role="status" a
  // screen reader stays silent until the operator manually navigates to
  // the card. Mirrors packages/ui/src/kiosk/verdict-screen.tsx's own
  // `role="status"` on its settled-verdict <section>. Scoped to ONLY the
  // settled-verdict root -- idle/resolving are transient in-progress states,
  // not the content that needs announcing.
  describe("live region (WCAG 4.1.3)", () => {
    it("announces the settled verdict via role=status", () => {
      const state: CheckinFlowState = { status: "verdict", verdict: "allowed", attendee: ADA };
      render(<VerdictCard state={state} />);

      expect(screen.getByRole("status")).toHaveAttribute("data-verdict", "allowed");
    });

    it("does not mark the idle state as a status live region", () => {
      const state: CheckinFlowState = { status: "idle" };
      render(<VerdictCard state={state} />);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("does not mark the resolving state as a status live region", () => {
      const state: CheckinFlowState = { status: "resolving" };
      render(<VerdictCard state={state} />);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
