// P4.1 Task 7 -- useScanInput tests. Exercises the three scan-input modes
// against the REAL agent MSW origin (http://agent.test), same convention as
// agentClient.test.ts / usePrintBadge.test.tsx: the agent is a separate
// origin from the backend, never mocked via vi.mock (agentClient itself is
// exercised for real, only its HTTP layer is intercepted).
//
// Wedge mode needs a genuine focused/typed-into DOM <input> (a keyboard-
// wedge scanner just "types" into whatever has focus + sends Enter), so
// this file renders small harness components around the hook (render/
// userEvent from @testing-library/react) rather than only using renderHook
// -- same reasoning as this repo's other DOM-interaction hook tests.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useScanInput, type UseScanInputOptions } from "./useScanInput";
import { startMswServer } from "../../test/msw";

let scanConsumeResponse: { code: string; time: string } = { code: "", time: "0001-01-01T00:00:00Z" };
let scanConsumeHitCount = 0;
let scanConsumeShouldError = false;

const server = startMswServer(
  http.post("http://agent.test/scan/consume", () => {
    scanConsumeHitCount += 1;
    if (scanConsumeShouldError) return new HttpResponse(null, { status: 500 });
    const response = scanConsumeResponse;
    // Real /scan/consume atomically clears the buffer server-side -- mimic
    // that here so a static scanConsumeResponse doesn't keep getting
    // "re-consumed" forever, matching how the real agent behaves and
    // proving the client no longer needs its own client-side dedup.
    scanConsumeResponse = { code: "", time: "0001-01-01T00:00:00Z" };
    return HttpResponse.json(response);
  }),
);
void server;

function WedgeHarness({ onCode, enabled = true }: { onCode: (code: string) => void; enabled?: boolean }) {
  const { wedgeInputProps } = useScanInput({ mode: "wedge", onCode, enabled });
  return <input aria-label="wedge-input" {...wedgeInputProps} />;
}

// PR #77 bot-review round 2, Finding 5 -- a stand-in for the OTHER
// focusable surfaces that actually exist alongside the wedge input on the
// real station page (ScanInput.tsx's manual search box, RecentScansRail.tsx's
// rail buttons and confirm dialogs): an unrelated plain button, a text input
// (standing in for the manual search box), and a `role="dialog"` region
// (standing in for a Reprint/Undo confirm dialog's content).
function WedgeWithOtherControlsHarness({ onCode, enabled = true }: { onCode: (code: string) => void; enabled?: boolean }) {
  const { wedgeInputProps } = useScanInput({ mode: "wedge", onCode, enabled });
  return (
    <div>
      <input aria-label="wedge-input" {...wedgeInputProps} />
      <button type="button">Other button</button>
      <input aria-label="manual-search" type="text" />
      <div role="dialog">
        <button type="button">Dialog confirm</button>
      </div>
    </div>
  );
}

function ScannerHarness({ onCode, enabled = true }: { onCode: (code: string) => void; enabled?: boolean }) {
  const { degraded } = useScanInput({ mode: "scanner", onCode, enabled });
  return <div data-testid="degraded">{String(degraded)}</div>;
}

function ManualHarness({ onCode }: { onCode: (code: string) => void }) {
  const { degraded } = useScanInput({ mode: "manual", onCode, enabled: true });
  return <div data-testid="degraded">{String(degraded)}</div>;
}

describe("useScanInput", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    scanConsumeResponse = { code: "", time: "0001-01-01T00:00:00Z" };
    scanConsumeHitCount = 0;
    scanConsumeShouldError = false;
  });

  describe("wedge mode", () => {
    it("autofocuses the hidden input on mount", () => {
      const onCode = vi.fn();
      render(<WedgeHarness onCode={onCode} />);
      expect(screen.getByLabelText("wedge-input")).toHaveFocus();
    });

    it("emits the buffered value once on Enter, then clears and refocuses the input", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      render(<WedgeHarness onCode={onCode} />);
      const input = screen.getByLabelText("wedge-input");

      await user.type(input, "PD-0107{Enter}");

      expect(onCode).toHaveBeenCalledTimes(1);
      expect(onCode).toHaveBeenCalledWith("PD-0107");
      expect(input).toHaveValue("");
      expect(input).toHaveFocus();
    });

    it("does not emit on a bare keystroke without Enter", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      render(<WedgeHarness onCode={onCode} />);
      const input = screen.getByLabelText("wedge-input");

      await user.type(input, "PD-0107");

      expect(onCode).not.toHaveBeenCalled();
      expect(input).toHaveValue("PD-0107");
    });

    it("never emits an empty code on a bare Enter", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      render(<WedgeHarness onCode={onCode} />);
      const input = screen.getByLabelText("wedge-input");

      await user.type(input, "{Enter}");

      expect(onCode).not.toHaveBeenCalled();
    });

    it("does not autofocus (or accept input) when disabled", () => {
      const onCode = vi.fn();
      render(<WedgeHarness onCode={onCode} enabled={false} />);
      const input = screen.getByLabelText("wedge-input");
      expect(input).not.toHaveFocus();
      expect(input).toBeDisabled();
    });

    // PR #77 bot-review round 2, Finding 5 -- focus must return to the
    // hidden wedge capture input after the operator clicks ANY unrelated,
    // non-text focusable element, not just on a `wedgeActive` transition --
    // otherwise a physical scan typed afterward lands nowhere and `onCode`
    // never fires.
    it("returns focus to the wedge input a short beat after the operator clicks an unrelated, non-text focusable element", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      render(<WedgeWithOtherControlsHarness onCode={onCode} />);
      expect(screen.getByLabelText("wedge-input")).toHaveFocus();

      await user.click(screen.getByRole("button", { name: "Other button" }));
      expect(screen.getByRole("button", { name: "Other button" })).toHaveFocus();

      await waitFor(() => expect(screen.getByLabelText("wedge-input")).toHaveFocus());
    });

    // The manual search box counterpart: focus must NOT be yanked away while
    // the operator is actively using it (they clicked in specifically to
    // type a name/email/code).
    it("does not yank focus away from a text input the operator just clicked into (the manual search box)", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      render(<WedgeWithOtherControlsHarness onCode={onCode} />);
      expect(screen.getByLabelText("wedge-input")).toHaveFocus();

      await user.click(screen.getByLabelText("manual-search"));
      expect(screen.getByLabelText("manual-search")).toHaveFocus();

      // Give the refocus timer every chance to fire before asserting it did
      // NOT -- this is the actual regression this test guards against.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(screen.getByLabelText("manual-search")).toHaveFocus();
    });

    // Same "don't fight an active interaction" rule, but for a dialog that's
    // now open (e.g. a Reprint/Undo confirm dialog) rather than a text
    // field -- the operator clicking its Confirm button must not have focus
    // yanked back to the (invisible) wedge input mid-interaction.
    it("does not yank focus away from a control inside an open dialog", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      render(<WedgeWithOtherControlsHarness onCode={onCode} />);
      expect(screen.getByLabelText("wedge-input")).toHaveFocus();

      await user.click(screen.getByRole("button", { name: "Dialog confirm" }));
      expect(screen.getByRole("button", { name: "Dialog confirm" })).toHaveFocus();

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(screen.getByRole("button", { name: "Dialog confirm" })).toHaveFocus();
    });

    it("does not refocus after a blur once wedge mode is no longer active (enabled flips false)", async () => {
      const user = userEvent.setup();
      const onCode = vi.fn();
      const { rerender } = render(<WedgeWithOtherControlsHarness onCode={onCode} />);
      expect(screen.getByLabelText("wedge-input")).toHaveFocus();

      rerender(<WedgeWithOtherControlsHarness onCode={onCode} enabled={false} />);
      await user.click(screen.getByRole("button", { name: "Other button" }));

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(screen.getByRole("button", { name: "Other button" })).toHaveFocus();
    });
  });

  describe("scanner mode", () => {
    it("polls agentClient.consumeLastScan, emits onCode exactly once for a scan", async () => {
      scanConsumeResponse = { code: "PD-0107", time: "2026-07-17T10:00:00Z" };
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      expect(onCode).toHaveBeenCalledWith("PD-0107");

      // The mock already cleared its own state on that first consume
      // (mirroring the real agent's atomic consume) -- further poll ticks
      // see the empty sentinel and must never re-emit.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(onCode).toHaveBeenCalledTimes(1);
      expect(scanConsumeHitCount).toBeGreaterThan(1);
    }, 10000);

    it("does not emit while the buffer is empty (the sentinel no-scan-yet state)", async () => {
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      await waitFor(() => expect(scanConsumeHitCount).toBeGreaterThan(1));
      expect(onCode).not.toHaveBeenCalled();
    });

    it("sets degraded:true when the agent is unreachable, and clears it again once reachable", async () => {
      scanConsumeShouldError = true;
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      await waitFor(() => expect(screen.getByTestId("degraded")).toHaveTextContent("true"));
      expect(onCode).not.toHaveBeenCalled();

      scanConsumeShouldError = false;
      await waitFor(() => expect(screen.getByTestId("degraded")).toHaveTextContent("false"));
    }, 10000);

    it("does not poll when disabled", async () => {
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} enabled={false} />);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(scanConsumeHitCount).toBe(0);
      expect(onCode).not.toHaveBeenCalled();
    });

    // Migration note: the OLD getLastScan/clearLastScan pair needed a
    // "retry the clear" mechanism, because a transient clearLastScan()
    // failure right after a successful getLastScan() left the scan already
    // fired to onCode but the agent's buffer still holding it (a stuck
    // buffer). The atomic consumeLastScan() has no equivalent failure mode:
    // if a poll's consumeLastScan() call fails, nothing was consumed
    // server-side at all -- the scan is still sitting untouched in the
    // agent's buffer, and the very next successful poll consumes and emits
    // it exactly once. No retry bookkeeping is needed on the client at all.
    it("does not lose a scan when a poll's consumeLastScan() call fails -- the next poll consumes and emits it", async () => {
      scanConsumeResponse = { code: "PD-0107", time: "2026-07-17T10:00:00Z" };
      scanConsumeShouldError = true;
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      // The failing poll(s) never reach the mock's clearing line -- the
      // scan is untouched, and onCode must not fire.
      await waitFor(() => expect(scanConsumeHitCount).toBeGreaterThan(0));
      expect(onCode).not.toHaveBeenCalled();

      scanConsumeShouldError = false;
      await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      expect(onCode).toHaveBeenCalledWith("PD-0107");

      // And no further re-emission on later polls.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(onCode).toHaveBeenCalledTimes(1);
    }, 10000);

    // PR #77 bot-review round 3, Finding 4 -- the 200ms poll interval
    // previously started a new `poll()` on every tick regardless of whether
    // the PREVIOUS round trip had actually finished. A local agent that
    // accepts a request but stalls (a real possibility on a loaded/slow
    // local network) could otherwise let in-flight requests accumulate
    // indefinitely. This guard is untouched by the migration -- still
    // verified here against the new endpoint.
    it("does not start a new poll while the previous consumeLastScan() round trip is still outstanding, and resumes once it resolves", async () => {
      let releaseScanConsume: (() => void) | undefined;
      const hang = new Promise<void>((resolve) => {
        releaseScanConsume = resolve;
      });
      server.use(
        http.post("http://agent.test/scan/consume", async () => {
          scanConsumeHitCount += 1;
          await hang;
          return HttpResponse.json(scanConsumeResponse);
        }),
      );
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      // The first poll starts (and hangs on the still-unresolved response).
      await waitFor(() => expect(scanConsumeHitCount).toBe(1));

      // Well past several 200ms poll intervals -- a NEW poll must never
      // start while the first one is still outstanding.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(scanConsumeHitCount).toBe(1);

      // Releasing the hung request lets normal polling resume.
      releaseScanConsume?.();
      await waitFor(() => expect(scanConsumeHitCount).toBeGreaterThan(1));
    }, 10000);
  });

  describe("manual mode", () => {
    it("never polls the agent and never emits onCode on its own", async () => {
      const onCode = vi.fn();
      render(<ManualHarness onCode={onCode} />);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(scanConsumeHitCount).toBe(0);
      expect(onCode).not.toHaveBeenCalled();
      expect(screen.getByTestId("degraded")).toHaveTextContent("false");
    });
  });
});

// Type-only sanity check: UseScanInputOptions accepts exactly the brief's
// shape. Not executed -- caught at typecheck time if the hook's signature
// ever drifts.
function _typeCheck(options: UseScanInputOptions) {
  return options;
}
void _typeCheck;
