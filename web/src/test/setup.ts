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

// jsdom doesn't implement IntersectionObserver, but useScrollSpy relies on
// it internally. Stub it so components using that hook can render in tests.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
