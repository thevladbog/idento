import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./useIsMobile";

type Listener = (event: { matches: boolean }) => void;

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  let matches = initialMatches;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(max-width: 767.98px)",
    addEventListener: (_type: "change", listener: Listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "change", listener: Listener) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    listeners,
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsMobile", () => {
  it("reflects the current viewport and updates when the media query flips", () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => media.setMatches(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const media = installMatchMedia(true);
    const { unmount } = renderHook(() => useIsMobile());
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
