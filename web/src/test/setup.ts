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
// Implements the full lib.dom.d.ts IntersectionObserver shape (root/rootMargin/
// thresholds/takeRecords), not just observe/unobserve/disconnect — a partial
// stub fails `tsc -b`'s structural check against the real interface, breaking
// `npm run build` (and therefore the web Docker image) even though vitest,
// which doesn't type-check this file the same way, was unaffected.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}
