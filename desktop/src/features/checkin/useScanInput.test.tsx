import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as agentLib from "../../lib/agent";
import { useScanInput } from "./useScanInput";

function WedgeHarness({ onCode, enabled = true }: { onCode: (code: string) => void; enabled?: boolean }) {
  const { wedgeInputProps } = useScanInput({ mode: "wedge", onCode, enabled });
  return <input aria-label="wedge-capture" {...wedgeInputProps} />;
}

describe("useScanInput — wedge mode", () => {
  it("fires onCode on Enter and clears the buffer", async () => {
    const user = userEvent.setup();
    const onCode = vi.fn();
    render(<WedgeHarness onCode={onCode} />);
    const input = screen.getByLabelText("wedge-capture");
    await user.type(input, "EVT-42{Enter}");
    expect(onCode).toHaveBeenCalledWith("EVT-42");
    expect(input).toHaveValue("");
  });

  it("does not fire onCode for an empty Enter", async () => {
    const user = userEvent.setup();
    const onCode = vi.fn();
    render(<WedgeHarness onCode={onCode} />);
    await user.type(screen.getByLabelText("wedge-capture"), "{Enter}");
    expect(onCode).not.toHaveBeenCalled();
  });
});

describe("useScanInput — scanner mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function ScannerHarness({ onCode }: { onCode: (code: string) => void }) {
    const { degraded } = useScanInput({ mode: "scanner", onCode, enabled: true });
    return <div data-testid="degraded">{String(degraded)}</div>;
  }

  it("polls consumeLastScan every 200ms and fires onCode on a non-empty result", async () => {
    const onCode = vi.fn();
    vi.spyOn(agentLib, "consumeLastScan").mockResolvedValue({ code: "EVT-1" });
    render(<ScannerHarness onCode={onCode} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(onCode).toHaveBeenCalledWith("EVT-1");
  });

  it("sets degraded when the agent poll fails", async () => {
    const onCode = vi.fn();
    vi.spyOn(agentLib, "consumeLastScan").mockRejectedValue(new Error("agent unreachable"));
    render(<ScannerHarness onCode={onCode} />);
    // Advance timers to allow promise rejection to be processed and state to update
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId("degraded")).toHaveTextContent("true");
  });
});

describe("useScanInput — manual mode", () => {
  it("wedgeInputProps.disabled is true (no auto-input at all)", () => {
    function ManualHarness() {
      const { wedgeInputProps } = useScanInput({ mode: "manual", onCode: () => {}, enabled: true });
      return <input aria-label="wedge-capture" {...wedgeInputProps} />;
    }
    render(<ManualHarness />);
    expect(screen.getByLabelText("wedge-capture")).toBeDisabled();
  });
});
