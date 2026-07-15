import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
