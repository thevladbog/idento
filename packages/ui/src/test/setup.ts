import "@testing-library/jest-dom/vitest";

// Radix Select (and other Radix popper primitives) call these; jsdom has no
// implementation, so without stubs opening a <Select> throws.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// @testing-library/dom's `waitFor`/`findBy*` only recognize *Jest's* fake
// timers (it feature-detects a global `jest` with a mocked `setTimeout`), so
// under Vitest's `vi.useFakeTimers()` its internal polling interval is
// scheduled on the faked clock and never fires — any test that awaits
// `findBy*`/`waitFor` while fake timers are active hangs until the real
// per-test timeout. Shimming a minimal `jest.advanceTimersByTime` (aliased to
// Vitest's own) makes testing-library detect fake timers and drive its
// polling through them instead of a dead real-time wait. See
// https://github.com/testing-library/dom-testing-library/issues/939.
declare global {
  var jest: { advanceTimersByTime: (ms: number) => void } | undefined;
}
if (typeof globalThis.jest === "undefined") {
  globalThis.jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
}
