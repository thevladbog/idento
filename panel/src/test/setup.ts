import "@testing-library/jest-dom/vitest";
import { expect, vi } from "vitest";
// NOT `from "vitest-axe"` -- verified empirically (node -e against the
// installed 0.1.0 package): the package root only re-exports `axe` /
// `configureAxe`; `toHaveNoViolations` lives in the `vitest-axe/matchers`
// subpath (its `extend-expect` subpath, which would auto-extend `expect`
// as a side effect the same way `@testing-library/jest-dom/vitest` does
// above, ships as a literal empty file in this version -- unusable), so
// the matcher is imported explicitly and extended by hand instead.
// NOT `from "vitest-axe/matchers"` either -- that package-root subpath's
// own .d.ts (node_modules/vitest-axe/matchers.d.ts) is
// `export type * from "./dist/matchers"`, a packaging bug that makes
// TypeScript (verbatimModuleSyntax) treat the real runtime function as
// type-only. `vitest-axe/dist/matchers` re-exports the identical runtime
// value with a correct (non-type-only) .d.ts one directory deeper.
import { toHaveNoViolations } from "vitest-axe/dist/matchers";

expect.extend({ toHaveNoViolations });

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

// jsdom's File/Blob don't implement the standard `arrayBuffer()` method
// (verified empirically: `new File([...]).arrayBuffer` is `undefined` under
// this project's Vitest jsdom environment) even though every real browser
// has it. The Task 11 import wizard calls `file.arrayBuffer()` directly per
// its brief rather than going through a FileReader-based helper, so this
// polyfills the one missing method via FileReader (which jsdom DOES
// implement) rather than avoiding the standard API in production code.
if (typeof File !== "undefined" && !File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function arrayBufferPolyfill(this: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

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
