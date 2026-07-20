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

// Task 2 (attendees Select migration): this repo currently has TWO physically
// distinct copies of @radix-ui/react-focus-scope installed — the hoisted one
// (used by Dialog/DropdownMenu) and a separately-pinned nested copy under
// @radix-ui/react-select (Task 1 added Select, which depends on a newer
// focus-scope patch than Dialog's own pin; `npm ls @radix-ui/react-focus-scope`
// shows both). Each copy keeps its OWN module-private "active focus scopes"
// stack, so when a Select's listbox opens while nested inside a Dialog (e.g.
// AttendeeDrawer's/BulkBar's printer Select inside their print-confirm
// Dialog, or ImportWizard's mapping Select inside its own wizard Dialog),
// neither scope's stack can pause the other the way two FocusScopes from the
// SAME module instance normally would. Real browsers coalesce rapid
// focus/blur; jsdom dispatches every focusin/focusout SYNCHRONOUSLY, so the
// two scopes' "return focus to my own last element" handlers can trigger
// each other back and forth with no browser-side debounce to stop it —
// `RangeError: Maximum call stack size exceeded`, reliably reproducing on
// close of a Select nested in a Dialog. A small reentrancy cap on
// `.focus()` breaks that specific runaway synchronous cycle (jsdom's own
// deviation from real focus-event timing, not a fix for the underlying
// dual-copy dependency skew) without changing where focus actually lands in
// any single, non-pathological call.
{
  const nativeFocus = HTMLElement.prototype.focus;
  let focusReentrancyDepth = 0;
  HTMLElement.prototype.focus = function focusWithReentrancyGuard(this: HTMLElement, ...args) {
    if (focusReentrancyDepth > 3) return;
    focusReentrancyDepth += 1;
    try {
      nativeFocus.apply(this, args);
    } finally {
      focusReentrancyDepth -= 1;
    }
  };
}
