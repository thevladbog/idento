import { act, renderHook } from "@testing-library/react";
import { useScrollSpy } from "./useScrollSpy";

// jsdom (this project's test environment) has no IntersectionObserver at
// all, and panel's global src/test/setup.ts intentionally doesn't stub one
// (no other suite needs it) — so this mock is self-contained to this file,
// ported from web/src/hooks/__tests__/useScrollSpy.test.ts's own mock.
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe("useScrollSpy", () => {
  let observerInstance: MockIntersectionObserver;

  beforeEach(() => {
    // No <main> wrapper: the panel port scrolls the window (root: null),
    // unlike web/'s closest('main') resolution, so sections can sit
    // anywhere in the document.
    document.body.innerHTML = `
      <div id="summary"></div>
      <div id="lifecycle"></div>
    `;
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function (cb: IntersectionObserverCallback) {
        observerInstance = new MockIntersectionObserver(cb);
        return observerInstance;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to the first section id", () => {
    const { result } = renderHook(() => useScrollSpy(["summary", "lifecycle"]));
    expect(result.current).toBe("summary");
  });

  it("updates to the section reported as intersecting", () => {
    const { result } = renderHook(() => useScrollSpy(["summary", "lifecycle"]));
    const lifecycleEl = document.getElementById("lifecycle")!;
    act(() => {
      observerInstance.callback(
        [{ isIntersecting: true, target: lifecycleEl } as unknown as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver,
      );
    });
    expect(result.current).toBe("lifecycle");
  });
});

describe("useScrollSpy - sections mounted after an async loading gate", () => {
  let observerInstance: MockIntersectionObserver;
  let rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    // Mirrors EventSettingsPage: the hook mounts while the page is still
    // showing a loading skeleton, before the section elements exist.
    document.body.innerHTML = "";
    rafCallback = null;

    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function (cb: IntersectionObserverCallback) {
        observerInstance = new MockIntersectionObserver(cb);
        return observerInstance;
      }),
    );
    // Capture the rAF callback instead of invoking it immediately, so the
    // test controls exactly when the retry fires (no real timing waits,
    // and no risk of an unbounded synchronous retry loop).
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops rescheduling rAF retries once the retry cap is exhausted if sections never appear", () => {
    const rafSpy = vi.mocked(requestAnimationFrame);
    renderHook(() => useScrollSpy(["summary", "lifecycle"]));

    // Sections never get added to the DOM. Flush the captured rAF callback
    // repeatedly, standing in for real frames — each flush re-schedules
    // itself (capturing a new rafCallback) until the retry cap is hit, at
    // which point it stops rescheduling and requestAnimationFrame stops
    // being called again.
    const callsBeforeCap = rafSpy.mock.calls.length;
    for (let i = 0; i < 200; i += 1) {
      const cb = rafCallback;
      if (cb === null) break;
      rafCallback = null;
      act(() => {
        cb(0);
      });
    }

    // The observer must never have been attached (no sections ever existed),
    // and the retry loop must have stopped well short of 200 (the bounded
    // cap is on the order of 100-150) instead of running forever.
    expect(observerInstance).toBeUndefined();
    expect(rafCallback).toBeNull();
    expect(rafSpy.mock.calls.length - callsBeforeCap).toBeLessThan(200);
    expect(rafSpy.mock.calls.length - callsBeforeCap).toBeGreaterThanOrEqual(100);
  });

  it("attaches the observer once sections appear post-mount and reflects intersection", () => {
    const { result } = renderHook(() => useScrollSpy(["summary", "lifecycle"]));

    // No elements exist yet, so the hook must not have set up an observer
    // and must have scheduled a retry instead of giving up silently.
    expect(result.current).toBe("summary");
    expect(rafCallback).not.toBeNull();

    // Simulate the loading gate resolving and the real sections mounting.
    document.body.innerHTML = `
      <div id="summary"></div>
      <div id="lifecycle"></div>
    `;

    // Flush the pending retry — this is when the observer actually attaches.
    act(() => {
      rafCallback!(0);
    });

    const lifecycleEl = document.getElementById("lifecycle")!;
    act(() => {
      observerInstance.callback(
        [{ isIntersecting: true, target: lifecycleEl } as unknown as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver,
      );
    });

    expect(result.current).toBe("lifecycle");
  });
});
