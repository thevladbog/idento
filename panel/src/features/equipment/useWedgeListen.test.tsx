// P4.3 Task 9 -- useWedgeListen: window-scoped keydown capture for the
// scanner wizard's listen step (board 5c). Fake timers throughout (the
// hook's own inter-key-gap and 300ms-silence logic both key off Date.now()/
// setTimeout, both faked by vi.useFakeTimers()) so every gap is asserted
// deterministically rather than relying on real wall-clock speed.
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useWedgeListen } from "./useWedgeListen";

function typeBurst(code: string, gapMs: number) {
  for (const char of code) {
    fireEvent.keyDown(window, { key: char });
    vi.advanceTimersByTime(gapMs);
  }
}

describe("useWedgeListen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects a fast burst terminated by Enter as terminator 'enter' with plausible millis", () => {
    const { result } = renderHook(() => useWedgeListen(true));

    act(() => {
      typeBurst("TEST-4471", 5);
      fireEvent.keyDown(window, { key: "Enter" });
    });

    expect(result.current.detection?.code).toBe("TEST-4471");
    expect(result.current.detection?.terminator).toBe("enter");
    expect(result.current.detection?.millis).toBeGreaterThan(0);
    expect(result.current.detection?.millis).toBeLessThan(200);
  });

  it("detects a burst terminated by Tab as terminator 'tab'", () => {
    const { result } = renderHook(() => useWedgeListen(true));

    act(() => {
      typeBurst("ABC1234", 3);
      fireEvent.keyDown(window, { key: "Tab" });
    });

    expect(result.current.detection?.code).toBe("ABC1234");
    expect(result.current.detection?.terminator).toBe("tab");
  });

  it("resolves terminator 'none' after 300ms of silence with no suffix key", () => {
    const { result } = renderHook(() => useWedgeListen(true));

    act(() => {
      typeBurst("PD-0107", 4);
      vi.advanceTimersByTime(300);
    });

    expect(result.current.detection?.code).toBe("PD-0107");
    expect(result.current.detection?.terminator).toBe("none");
  });

  it("captures nothing while inactive", () => {
    const { result } = renderHook(() => useWedgeListen(false));

    act(() => {
      typeBurst("TEST-4471", 5);
      fireEvent.keyDown(window, { key: "Enter" });
      vi.advanceTimersByTime(300);
    });

    expect(result.current.detection).toBeNull();
  });

  it("reset() clears a captured detection so listening can resume for a fresh scan", () => {
    const { result } = renderHook(() => useWedgeListen(true));

    act(() => {
      typeBurst("TEST-4471", 2);
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(result.current.detection?.code).toBe("TEST-4471");

    act(() => result.current.reset());
    expect(result.current.detection).toBeNull();

    act(() => {
      typeBurst("NEW-0099", 2);
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(result.current.detection?.code).toBe("NEW-0099");
  });

  it("never yields a detection when typed slower than the wedge threshold (>80ms/char)", () => {
    const { result } = renderHook(() => useWedgeListen(true));

    act(() => {
      typeBurst("TEST-4471", 120);
      fireEvent.keyDown(window, { key: "Enter" });
      vi.advanceTimersByTime(300);
    });

    expect(result.current.detection).toBeNull();
  });

  it("ignores a modifier-combo keydown (never buffers a shortcut like Ctrl+R)", () => {
    const { result } = renderHook(() => useWedgeListen(true));

    act(() => {
      typeBurst("AB", 5);
      fireEvent.keyDown(window, { key: "R", ctrlKey: true });
      typeBurst("C4471", 5);
      fireEvent.keyDown(window, { key: "Enter" });
    });

    expect(result.current.detection?.code).toBe("ABC4471");
  });

  // Task 9 review round 2, Important: the wizard's always-editable fields
  // (round-1's Important-1 restructure) coexist with this window-level
  // listener, so a fast typist bursting 3+ chars at wedge speed INTO the
  // Device name input used to fabricate a detection. Keydowns whose target
  // is an editable element must be ignored for detection purposes AND
  // clear the accumulator (no mixed bursts).
  it("never detects from a wedge-speed burst targeted at an editable element, and such a keydown clears any accumulated burst", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      const { result } = renderHook(() => useWedgeListen(true));

      // A full wedge-speed burst typed INTO the input -- Enter suffix AND
      // the 300ms silence path both stay silent.
      act(() => {
        for (const char of "TEST-4471") {
          fireEvent.keyDown(input, { key: char });
          vi.advanceTimersByTime(5);
        }
        fireEvent.keyDown(input, { key: "Enter" });
        vi.advanceTimersByTime(300);
      });
      expect(result.current.detection).toBeNull();

      // A partial window-level burst interrupted by an input-targeted
      // keydown is discarded outright -- the accumulator is clean, so a
      // later legitimate scan detects exactly its own code, never a mix.
      act(() => {
        typeBurst("AB", 5);
        fireEvent.keyDown(input, { key: "C" });
        vi.advanceTimersByTime(5);
        typeBurst("XYZ-1", 5);
        fireEvent.keyDown(window, { key: "Enter" });
      });
      expect(result.current.detection?.code).toBe("XYZ-1");
    } finally {
      document.body.removeChild(input);
    }
  });

  it("still detects a burst targeted at a non-editable element (e.g. a focused button)", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    try {
      const { result } = renderHook(() => useWedgeListen(true));

      act(() => {
        for (const char of "BTN-7771") {
          fireEvent.keyDown(button, { key: char });
          vi.advanceTimersByTime(5);
        }
        fireEvent.keyDown(button, { key: "Enter" });
      });

      expect(result.current.detection?.code).toBe("BTN-7771");
      expect(result.current.detection?.terminator).toBe("enter");
    } finally {
      document.body.removeChild(button);
    }
  });
});
