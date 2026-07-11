import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver, but cmdk (used by the `Command` UI
// primitive) relies on it internally to measure its list. Stub it so any
// component built on `Command` can render in tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement Element.scrollIntoView either, and cmdk calls it
// when moving the "active" highlighted item into view.
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
