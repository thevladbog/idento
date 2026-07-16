import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BadgeCanvas, type BadgeCanvasProps } from "./BadgeCanvas";
import type { BadgeTemplateDoc } from "./templateTypes";
import "../../shared/i18n";

// jsdom does not implement pointer capture (verified: `Element.prototype.
// setPointerCapture` is undefined under this project's Vitest jsdom
// environment, same gap `panel/src/test/setup.ts` documents for other
// missing jsdom APIs) -- no existing project-wide stub covers it, so it's
// stubbed locally here, scoped to this file only.
//
// jsdom (v25.0.1, this repo's pinned version) also has NO `PointerEvent`
// constructor at all -- verified empirically: `window.PointerEvent` is
// `undefined`. @testing-library/dom's `fireEvent.pointerDown/Move/Up`
// looks up `window[EventType] || window.Event` (its `createEvent` helper)
// and silently falls back to a plain `Event` when the specific
// constructor is missing, which drops clientX/clientY/pointerId/button
// entirely -- every one of those fields BadgeCanvas's drag math reads.
// jsdom's `MouseEvent`, unlike `PointerEvent`, IS implemented and DOES
// honor clientX/clientY/button in its constructor init dict (verified
// empirically too), so a minimal polyfill layered on top of it -- adding
// only `pointerId` -- is enough to make `fireEvent.pointerDown/Move/Up`
// carry the real values this component's handlers need.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();

  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  // @ts-expect-error -- test-only jsdom polyfill, not a spec-complete PointerEvent
  window.PointerEvent = PointerEventPolyfill;
});

function docWith(elements: BadgeTemplateDoc["elements"], overrides: Partial<BadgeTemplateDoc> = {}): BadgeTemplateDoc {
  return { width_mm: 90, height_mm: 55, dpi: 300, elements, ...overrides };
}

function renderCanvas(overrides: Partial<BadgeCanvasProps> = {}) {
  const onSelect = vi.fn();
  const onMove = vi.fn();
  const onResize = vi.fn();
  const props: BadgeCanvasProps = {
    doc: docWith([]),
    selectedId: null,
    previewData: {},
    onSelect,
    onMove,
    onResize,
    ...overrides,
  };
  const utils = render(<BadgeCanvas {...props} />);
  return { onSelect, onMove, onResize, ...utils };
}

describe("BadgeCanvas", () => {
  it("shows the artboard caption with width/height/dpi and the permanent approximation notice", () => {
    renderCanvas({ doc: docWith([]) });

    expect(screen.getByText("90 × 55 mm · 300 dpi")).toBeInTheDocument();
    expect(
      screen.getByText("Preview approximation — print truth comes with the ZPL preview"),
    ).toBeInTheDocument();
  });

  describe("renders each element type", () => {
    it("text: resolves the bound source over previewData, static text otherwise", () => {
      renderCanvas({
        doc: docWith([
          { id: "t1", type: "text", x: 5, y: 5, source: "first_name", text: "fallback" },
          { id: "t2", type: "text", x: 5, y: 20, text: "Static label" },
        ]),
        previewData: { first_name: "Anna" },
      });

      expect(screen.getByText("Anna")).toBeInTheDocument();
      expect(screen.getByText("Static label")).toBeInTheDocument();
    });

    it("qrcode: renders a real <svg> QR code for the resolved value", async () => {
      renderCanvas({
        doc: docWith([{ id: "q1", type: "qrcode", x: 5, y: 5, width: 15, height: 15, source: "code" }]),
        previewData: { code: "ABC123" },
      });

      const el = screen.getByTestId("badge-canvas-element-q1");
      await waitFor(() => expect(el.querySelector("svg")).not.toBeNull());
    });

    it("barcode: shows a striped approximation block labeled as such, plus mono resolved text", () => {
      renderCanvas({
        doc: docWith([{ id: "b1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code" }]),
        previewData: { code: "ZZ-9" },
      });

      const el = screen.getByTestId("badge-canvas-element-b1");
      expect(el).toHaveTextContent("ZZ-9");
      expect(screen.getByLabelText(/approximation/i)).toBeInTheDocument();
    });

    // P3.1 Task 12 (spec §6 "never invented values"): a bound element whose
    // source resolves to nothing for the current previewData carries a
    // `title` hint. No static `text` fallback here (ElementsPane's own
    // default for a source-bound text element is `text: ""`), so
    // resolveElementText's existing, unchanged fallback-to-text rule
    // naturally renders empty too -- the hint layers on TOP of that, it
    // doesn't change what gets rendered.
    it("a bound element whose source is missing from previewData renders empty text and a title hint", () => {
      renderCanvas({
        doc: docWith([{ id: "t3", type: "text", x: 5, y: 5, source: "dietary", text: "" }]),
        previewData: {},
      });

      const el = screen.getByTestId("badge-canvas-element-t3");
      expect(el).toHaveAttribute("title", "Empty for this attendee — no invented value shown.");
      expect(el.textContent).toBe("");
    });

    it("carries no title hint when the bound source resolves (or the element is unbound)", () => {
      renderCanvas({
        doc: docWith([
          { id: "t4", type: "text", x: 5, y: 5, source: "first_name", text: "fallback" },
          { id: "t5", type: "text", x: 5, y: 20, text: "Static label" },
        ]),
        previewData: { first_name: "Anna" },
      });

      expect(screen.getByTestId("badge-canvas-element-t4")).not.toHaveAttribute("title");
      expect(screen.getByTestId("badge-canvas-element-t5")).not.toHaveAttribute("title");
    });

    // P3.2 Task 4: a customFont element gets that family in its inline
    // style -- a VISUAL approximation only (the true print raster happens
    // at generation, reconciliation #11), pinned as a one-line change.
    it("text with customFont: renders with that font-family in its inline style", () => {
      renderCanvas({
        doc: docWith([{ id: "t1", type: "text", x: 5, y: 5, text: "Hi", customFont: "Roboto" }]),
      });

      expect(screen.getByText("Hi")).toHaveStyle({ fontFamily: "Roboto" });
    });

    it("text without customFont: no font-family style is applied", () => {
      renderCanvas({
        doc: docWith([{ id: "t1", type: "text", x: 5, y: 5, text: "Hi" }]),
      });

      expect(screen.getByText("Hi").style.fontFamily).toBe("");
    });

    it("line and box: render as bordered divs", () => {
      renderCanvas({
        doc: docWith([
          { id: "l1", type: "line", x: 5, y: 5, width: 30, height: 0.5 },
          { id: "x1", type: "box", x: 5, y: 20, width: 20, height: 10 },
        ]),
      });

      expect(screen.getByTestId("badge-canvas-element-l1").firstChild).toHaveClass("border-2");
      expect(screen.getByTestId("badge-canvas-element-x1").firstChild).toHaveClass("border-2");
    });
  });

  describe("selection", () => {
    const doc = docWith([
      { id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 },
      { id: "e2", type: "box", x: 30, y: 5, width: 20, height: 10 },
    ]);

    it("shows the outline and 4 corner handles only on the selected element", () => {
      renderCanvas({ doc, selectedId: "e1" });

      const selected = screen.getByTestId("badge-canvas-element-e1");
      const unselected = screen.getByTestId("badge-canvas-element-e2");

      expect(selected.className).toMatch(/outline/);
      expect(unselected.className).not.toMatch(/outline/);

      expect(screen.getByTestId("badge-canvas-handle-e1-nw")).toBeInTheDocument();
      expect(screen.getByTestId("badge-canvas-handle-e1-ne")).toBeInTheDocument();
      expect(screen.getByTestId("badge-canvas-handle-e1-sw")).toBeInTheDocument();
      expect(screen.getByTestId("badge-canvas-handle-e1-se")).toBeInTheDocument();
      expect(screen.queryByTestId("badge-canvas-handle-e2-se")).not.toBeInTheDocument();
    });

    it("clicking an element calls onSelect with its id", () => {
      const { onSelect } = renderCanvas({ doc });

      fireEvent.click(screen.getByTestId("badge-canvas-element-e2"));

      expect(onSelect).toHaveBeenCalledWith("e2");
    });
  });

  describe("pointer drag (move)", () => {
    it("dispatches a clamped, 0.5mm-snapped move after a pointerdown/move/up sequence", () => {
      // 90x55mm @ the fixed 480x312px nominal viewport -> scale = 4.8 px/mm
      // (canvasMath.test.ts's own worked example). 48px = 10mm at that scale.
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
      });
      const el = screen.getByTestId("badge-canvas-element-e1");

      fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 148, clientY: 100 });

      expect(onMove).toHaveBeenCalledWith("e1", 15, 5); // 5mm + 10mm, y unchanged

      fireEvent.pointerUp(el, { pointerId: 1, clientX: 148, clientY: 100 });
    });

    it("clamps a drag that would push the element past the artboard edge", () => {
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
      });
      const el = screen.getByTestId("badge-canvas-element-e1");

      fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      // Huge rightward drag: way past the 90mm board edge.
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 4000, clientY: 0 });

      // max-fitting x for a 20mm-wide element on a 90mm board is 70.
      expect(onMove).toHaveBeenCalledWith("e1", 70, 5);
    });

    it("ignores pointermove events for a different, uncaptured pointerId", () => {
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
      });
      const el = screen.getByTestId("badge-canvas-element-e1");

      fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      fireEvent.pointerMove(el, { pointerId: 2, clientX: 48, clientY: 0 });

      expect(onMove).not.toHaveBeenCalled();
    });
  });

  describe("corner drag (resize)", () => {
    it("dragging the se (bottom-right) handle dispatches a clamped resize without moving x/y", () => {
      const { onResize, onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
        selectedId: "e1", // resize handles only render on the selected element
      });
      const handle = screen.getByTestId("badge-canvas-handle-e1-se");

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      // +48px = +10mm on each axis at 4.8 px/mm.
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 148, clientY: 148 });

      expect(onResize).toHaveBeenCalledWith("e1", 30, 20);
      expect(onMove).not.toHaveBeenCalled();

      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 148, clientY: 148 });
    });

    it("dragging the nw (top-left) handle moves x/y while keeping the opposite (se) corner anchored", () => {
      // e1 spans x:[5,25], y:[5,15] (x=5,width=20 / y=5,height=10) -- the
      // se corner (25, 15) is the fixed anchor for an nw-handle drag.
      const { onResize, onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
        selectedId: "e1",
      });
      const handle = screen.getByTestId("badge-canvas-handle-e1-nw");

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      // +24px = +5mm on each axis at 4.8 px/mm: dragging nw right/down by
      // 5mm should shrink the box to width=15/height=5 while x/y move to
      // 10/10 -- the se anchor (25, 15) stays exactly where it was
      // (10+15=25, 10+5=15).
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 124, clientY: 124 });

      expect(onResize).toHaveBeenCalledWith("e1", 15, 5);
      expect(onMove).toHaveBeenCalledWith("e1", 10, 10);
    });

    it("clamps an nw-handle overshoot (past the shrink limit) without letting the se anchor drift", () => {
      // Same e1 as above (se anchor fixed at 25, 15). A huge nw drag would
      // naively compute width/height going negative -- this must clamp to
      // minMm (1) while keeping the RIGHT/BOTTOM edge pinned at the
      // anchor: x = 25 - 1 = 24, y = 15 - 1 = 14. A buggy implementation
      // that clamps position and size independently lets x/y drift far
      // past the anchor instead (regression coverage for that bug).
      const { onResize, onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
        selectedId: "e1",
      });
      const handle = screen.getByTestId("badge-canvas-handle-e1-nw");

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      // +4800px = +1000mm at 4.8 px/mm -- wildly overshoots the 20mm/10mm
      // footprint being shrunk.
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 4800, clientY: 4800 });

      expect(onResize).toHaveBeenCalledWith("e1", 1, 1);
      expect(onMove).toHaveBeenCalledWith("e1", 24, 14);
    });
  });

  describe("keyboard nudge", () => {
    it("moves the selected element 0.5mm per arrow key", () => {
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
        selectedId: "e1",
      });

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "ArrowRight" });
      expect(onMove).toHaveBeenCalledWith("e1", 5.5, 5);

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "ArrowDown" });
      expect(onMove).toHaveBeenCalledWith("e1", 5, 5.5);
    });

    it("moves 2mm per arrow key when Shift is held", () => {
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
        selectedId: "e1",
      });

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "ArrowLeft", shiftKey: true });
      expect(onMove).toHaveBeenCalledWith("e1", 3, 5);
    });

    it("does nothing when no element is selected", () => {
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
        selectedId: null,
      });

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "ArrowRight" });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("clamps an edge nudge with the element's rendered footprint, matching where drag would stop", () => {
      // A text element with NO explicit width/height renders with the
      // canvas's default text footprint (40x8mm) -- the same footprint the
      // drag path clamps against. On a 90mm-wide board the max-fitting x
      // for that footprint is 50; a nudge from x=50 must stay clamped at
      // 50, NOT slide to 50.5 by clamping a zero-size box (regression
      // coverage: nudge and drag must use the SAME footprint fallback).
      const { onMove } = renderCanvas({
        doc: docWith([{ id: "t1", type: "text", x: 50, y: 5, text: "Hi" }]),
        selectedId: "t1",
      });

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "ArrowRight" });
      expect(onMove).toHaveBeenCalledWith("t1", 50, 5);
    });
  });

  describe("focus-to-nudge", () => {
    it("focuses the artboard when an element is clicked, so arrow-nudge works without a Tab stop first", () => {
      renderCanvas({
        doc: docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }]),
      });

      fireEvent.click(screen.getByTestId("badge-canvas-element-e1"));

      expect(document.activeElement).toBe(screen.getByTestId("badge-canvas-artboard"));
    });
  });

  describe("Escape", () => {
    it("deselects (calls onSelect(null)) and swallows the event when something is selected", () => {
      const parentKeyDown = vi.fn();
      const onSelect = vi.fn();
      render(
        <div onKeyDown={parentKeyDown}>
          <BadgeCanvas
            doc={docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }])}
            selectedId="e1"
            previewData={{}}
            onSelect={onSelect}
            onMove={vi.fn()}
            onResize={vi.fn()}
          />
        </div>,
      );

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "Escape" });

      expect(onSelect).toHaveBeenCalledWith(null);
      expect(parentKeyDown).not.toHaveBeenCalled(); // swallowed, not the page-level dirty guard's job here
    });

    it("propagates (does not call onSelect) when nothing is selected, so a page-level listener can react", () => {
      const parentKeyDown = vi.fn();
      const onSelect = vi.fn();
      render(
        <div onKeyDown={parentKeyDown}>
          <BadgeCanvas
            doc={docWith([{ id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 }])}
            selectedId={null}
            previewData={{}}
            onSelect={onSelect}
            onMove={vi.fn()}
            onResize={vi.fn()}
          />
        </div>,
      );

      fireEvent.keyDown(screen.getByTestId("badge-canvas-artboard"), { key: "Escape" });

      expect(onSelect).not.toHaveBeenCalled();
      expect(parentKeyDown).toHaveBeenCalled(); // bubbled through to the page-level guard
    });
  });
});
