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

let scanLastResponse: { code: string; time: string } = { code: "", time: "0001-01-01T00:00:00Z" };
let scanLastHitCount = 0;
let scanLastShouldError = false;
let scanClearHitCount = 0;
// PR #77 bot-review round, Finding P -- lets a test make the NEXT
// `/scan/clear` call fail without touching `/scan/last`'s own error toggle
// above (a clear failure must not also look like the agent being
// unreachable for `getLastScan`).
let scanClearShouldFailNext = false;

const server = startMswServer(
  http.get("http://agent.test/scan/last", () => {
    scanLastHitCount += 1;
    if (scanLastShouldError) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json(scanLastResponse);
  }),
  http.post("http://agent.test/scan/clear", () => {
    scanClearHitCount += 1;
    if (scanClearShouldFailNext) {
      scanClearShouldFailNext = false;
      return new HttpResponse(null, { status: 500 });
    }
    return HttpResponse.json({ status: "cleared" });
  }),
);
void server;

function WedgeHarness({ onCode, enabled = true }: { onCode: (code: string) => void; enabled?: boolean }) {
  const { wedgeInputProps } = useScanInput({ mode: "wedge", onCode, enabled });
  return <input aria-label="wedge-input" {...wedgeInputProps} />;
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
    scanLastResponse = { code: "", time: "0001-01-01T00:00:00Z" };
    scanLastHitCount = 0;
    scanLastShouldError = false;
    scanClearHitCount = 0;
    scanClearShouldFailNext = false;
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
  });

  describe("scanner mode", () => {
    it("polls agentClient.getLastScan, emits onCode once for a new scan, and clears the agent buffer", async () => {
      scanLastResponse = { code: "PD-0107", time: "2026-07-17T10:00:00Z" };
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      expect(onCode).toHaveBeenCalledWith("PD-0107");
      await waitFor(() => expect(scanClearHitCount).toBe(1));

      // A second (and third) poll cycle sees the SAME {code, time} pair
      // (this mock never changes) -- must never re-emit or re-clear.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(onCode).toHaveBeenCalledTimes(1);
      expect(scanClearHitCount).toBe(1);
      expect(scanLastHitCount).toBeGreaterThan(1);
    }, 10000);

    it("does not emit while the buffer is empty (the sentinel no-scan-yet state)", async () => {
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      await waitFor(() => expect(scanLastHitCount).toBeGreaterThan(1));
      expect(onCode).not.toHaveBeenCalled();
    });

    it("sets degraded:true when the agent is unreachable, and clears it again once reachable", async () => {
      scanLastShouldError = true;
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      await waitFor(() => expect(screen.getByTestId("degraded")).toHaveTextContent("true"));
      expect(onCode).not.toHaveBeenCalled();

      scanLastShouldError = false;
      await waitFor(() => expect(screen.getByTestId("degraded")).toHaveTextContent("false"));
    }, 10000);

    it("does not poll when disabled", async () => {
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} enabled={false} />);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(scanLastHitCount).toBe(0);
      expect(onCode).not.toHaveBeenCalled();
    });

    // PR #77 bot-review round, Finding P -- the CURRENT code's dedup check
    // (`last.code === scan.code && last.time === scan.time`) previously
    // caused the poll to see the same still-uncleared pair and exit early
    // WITHOUT re-attempting the clear (since it's already in
    // `lastHandledRef`), leaving the agent's buffer stuck forever after a
    // single transient clear failure -- even though the scan itself was
    // correctly consumed exactly once (no double-emit).
    it("retries a failed clearLastScan() on the next poll of the SAME scan, without re-emitting onCode", async () => {
      scanLastResponse = { code: "PD-0107", time: "2026-07-17T10:00:00Z" };
      scanClearShouldFailNext = true;
      const onCode = vi.fn();
      render(<ScannerHarness onCode={onCode} />);

      // First poll: onCode fires once, the clear is attempted and FAILS.
      await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(scanClearHitCount).toBe(1));

      // A later poll sees the SAME {code, time} pair (this mock never
      // changes it) -- the clear is retried (a second /scan/clear hit),
      // but onCode must NOT fire again.
      await waitFor(() => expect(scanClearHitCount).toBe(2), { timeout: 10000 });
      expect(onCode).toHaveBeenCalledTimes(1);

      // And once the clear finally succeeds, no FURTHER retries happen.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(scanClearHitCount).toBe(2);
      expect(onCode).toHaveBeenCalledTimes(1);
    }, 15000);
  });

  describe("manual mode", () => {
    it("never polls the agent and never emits onCode on its own", async () => {
      const onCode = vi.fn();
      render(<ManualHarness onCode={onCode} />);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(scanLastHitCount).toBe(0);
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
