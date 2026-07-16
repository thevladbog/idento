import { cn } from "@idento/ui";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { QrSvg } from "../staff/QrSvg";
import {
  clampPosition, clampSize, elementFootprint, fitScale, mmToPx, pxToMm, resolveElementText,
} from "./canvasMath";
import type { BadgeElement, BadgeTemplateDoc } from "./templateTypes";

export interface BadgeCanvasProps {
  doc: BadgeTemplateDoc;
  selectedId: string | null;
  // Task 12's job to populate for real; an empty object is a valid input
  // today (BadgeEditorPage passes `{}` until Task 12 lands) and every
  // element just falls back to its static `text` per resolveElementText's
  // documented semantics -- never a crash, never a fabricated value.
  previewData: Record<string, string>;
  // Accepts `null` (not just an element id) because the canvas itself needs
  // to deselect -- both on Escape (below) and implicitly when nothing on
  // the canvas is under the pointer. ElementsPane's own `onSelect` prop
  // only ever calls this with a string; a page wiring the SAME dispatch
  // callback into both panes is safe (a `(id: string | null) => void`
  // callback satisfies a narrower `(id: string) => void` prop type).
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
}

// Part of the SAME documented non-token-color exception as the literal-white
// artboard face below (the plan's Global Constraints "token classes only"
// line, docs/superpowers/plans/2026-07-16-panel-p3.1-badge-editor.md line
// 21 -- same pattern as QrSvg.tsx / print.css): the wrapper represents the
// physical WORK SURFACE around a physical badge and must stay the board's
// theme-invariant dark neutral (#3f3f46, board §4a's "neutral artboard
// chrome") in BOTH themes. A token class here (`bg-foreground/90` was the
// plan text's drafting error) inverts in dark mode (--foreground flips
// #18181b -> #f4f4f5, packages/ui/src/theme.css:7,40), leaving a white
// artboard floating on a near-white wrapper. The two caption colors are the
// board's own footer-text neutrals (#c8c8cd spec line, #8e8e96 muted link)
// -- fixed for the same reason: they sit ON the fixed-dark surface, so a
// theme-flipping text token (`text-background` is #101012 in dark mode)
// would go dark-on-dark.
const WORK_SURFACE_BG = "#3f3f46";
const WORK_SURFACE_CAPTION = "#c8c8cd";
const WORK_SURFACE_CAPTION_MUTED = "#8e8e96";

// Same exception, artboard CONTENTS: everything drawn on the white badge
// face represents physical thermal print, which is always black-on-white
// (exactly why QrSvg renders literal black modules) -- a theme token
// (`text-foreground`/`border-foreground` flip to #f4f4f5 in dark mode)
// would render the badge's own text/lines INVISIBLE on the fixed-white
// face. INK = the print itself; INK_MUTED = editor-only annotation text
// on the face (the barcode's value line) that isn't print truth.
const ARTBOARD_INK = "#000000";
const ARTBOARD_INK_MUTED = "#52525b";

// The px viewport the artboard fits into (canvasMath's fitScale). This is a
// FIXED design-time size, not a live-measured container size: jsdom (this
// repo's test environment) always reports 0 for clientWidth/clientHeight,
// so a ResizeObserver-driven responsive scale could never be asserted by a
// component test, and no zoom/"Fit" control is in this task's scope (board
// 4a shows one, but the P3.1 plan's reconciliation #11 only commits to
// hand-rolled pointer-based drag/resize -- a zoom control is a separate,
// later YAGNI call). These numbers are canvasMath.ts's own worked example:
// a 90x55mm label fits this viewport at exactly 4.8 px/mm, matching the
// board's 432x264px artboard depiction.
const CANVAS_VIEWPORT_PX = { w: 480, h: 312 };

// Pointer drag/resize snaps to this mm grain (brief: "mm-snapped to 0.5mm").
const DRAG_SNAP_MM = 0.5;

function snapMm(mm: number): number {
  return Math.round(mm / DRAG_SNAP_MM) * DRAG_SNAP_MM;
}

// Keyboard nudge distances -- the a11y-required non-pointer path for both
// moving and (indirectly, via repeated small moves) positioning an element
// (WCAG 1.4.1-adjacent: pointer-only drag/resize would leave keyboard-only
// operators with no way to reposition an element at all).
const NUDGE_MM = 0.5;
const NUDGE_MM_SHIFT = 2;

// Element footprint fallbacks (DEFAULT_SIZE_MM/elementFootprint) now live
// in canvasMath.ts, imported above -- promoted from this file's private
// helpers so PropertiesPane's typed X/Y/Width/Height clamps share the SAME
// footprint rule as this file's drag/nudge paths (one footprint rule; see
// canvasMath.ts's elementFootprint doc).

// 1 point = 1/72 inch = 25.4/72 mm -- used only to size a text element's
// on-screen font from its `fontSize` (points, per templateTypes.ts/zpl.go),
// never to move/resize an element (that math is canvasMath-only).
const MM_PER_POINT = 25.4 / 72;

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

// Per corner, which side of the element that corner's OPPOSITE (anchor)
// corner sits on, per axis: `1` = anchor at the start x/y (box grows
// toward larger x/y, same shape clampSize itself assumes); `-1` = anchor
// at start x+width/y+height (box grows toward smaller x/y instead). See
// handlePointerMove's resize branch for how this drives the anchor math.
const GROW_DIR: Record<Corner, { x: 1 | -1; y: 1 | -1 }> = {
  se: { x: 1, y: 1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  nw: { x: -1, y: -1 },
};

// Keyboard-nudge directions, keyed by KeyboardEvent.key. Module-level (not
// recreated every render) since it never depends on props/state.
const ARROW_DELTA: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

interface DragState {
  kind: "move" | "resize";
  corner?: Corner;
  pointerId: number;
  captureTarget: HTMLDivElement;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

// Board's §4a artboard framing (dark neutral wrapper, white label face) --
// P3.1 Task 8.
export function BadgeCanvas({
  doc, selectedId, previewData, onSelect, onMove, onResize,
}: BadgeCanvasProps) {
  const { t } = useTranslation();
  const scale = fitScale(doc, CANVAS_VIEWPORT_PX);
  const boardWidthPx = mmToPx(doc.width_mm, scale);
  const boardHeightPx = mmToPx(doc.height_mm, scale);

  // One ref, not React state: drag position updates happen many times a
  // second and only need to feed synchronous math (never re-render this
  // component directly -- the PARENT re-renders it once the "move"/
  // "resize" dispatch round-trips through the editor reducer and back down
  // as new `doc` props).
  const dragRef = React.useRef<DragState | null>(null);

  // The artboard is the keyboard-nudge listener (tabIndex=0 +
  // handleArtboardKeyDown below); selecting an element by CLICK must also
  // move focus there, or the documented arrow-key nudge path would only
  // work after a separate Tab stop -- a pointer-select would silently
  // strand keyboard use.
  const artboardRef = React.useRef<HTMLDivElement | null>(null);

  function selectByClick(id: string) {
    artboardRef.current?.focus();
    onSelect(id);
  }

  function beginMove(event: React.PointerEvent<HTMLDivElement>, el: BadgeElement) {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const { width, height } = elementFootprint(el);
    dragRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      captureTarget: target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: el.x,
      startY: el.y,
      startWidth: width,
      startHeight: height,
    };
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>, el: BadgeElement, corner: Corner) {
    // Stop this pointerdown from also bubbling into the element's own
    // onPointerDown (beginMove) -- a corner-drag is a resize, never
    // simultaneously a move-drag of the same gesture.
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const { width, height } = elementFootprint(el);
    dragRef.current = {
      kind: "resize",
      corner,
      pointerId: event.pointerId,
      captureTarget: target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: el.x,
      startY: el.y,
      startWidth: width,
      startHeight: height,
    };
  }

  // Bound on the element's own root div; also fires for a resize handle's
  // pointermove because Pointer Events still bubble up from the (capture-
  // retargeted) handle to its parent -- one implementation of the drag
  // math for both move and resize, not two.
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>, el: BadgeElement) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaXMm = pxToMm(event.clientX - drag.startClientX, scale);
    const deltaYMm = pxToMm(event.clientY - drag.startClientY, scale);

    if (drag.kind === "move") {
      const next = clampPosition(
        {
          x: snapMm(drag.startX + deltaXMm),
          y: snapMm(drag.startY + deltaYMm),
          width: drag.startWidth,
          height: drag.startHeight,
        },
        doc,
      );
      onMove(el.id, next.x, next.y);
      return;
    }

    // Resize: the corner OPPOSITE the one being dragged is the anchor and
    // must never move, however far the drag overshoots. `GROW_DIR` says,
    // per axis, whether the anchor sits on the low side (anchor fixed at
    // start x/y, box grows toward +width/+height -- exactly clampSize's
    // own "el.x/el.y fixed, bounded by config dimension - x/y" shape) or
    // the high side (anchor fixed at start x+width/y+height, box grows
    // toward -width/-height instead). For a high-side anchor, clampSize is
    // still the ONLY clamp arithmetic used, just fed a MIRRORED coordinate
    // (`config dimension - anchor`) so its "bounded by dimension - x"
    // formula resolves to the mirror-equivalent "bounded by anchor itself"
    // constraint a shrink-toward-0 needs -- see canvasMath.ts's clampSize
    // for the formula this mirrors.
    const dir = GROW_DIR[drag.corner!];
    const anchorX = dir.x === 1 ? drag.startX : drag.startX + drag.startWidth;
    const anchorY = dir.y === 1 ? drag.startY : drag.startY + drag.startHeight;
    const rawWidth = snapMm(drag.startWidth + dir.x * deltaXMm);
    const rawHeight = snapMm(drag.startHeight + dir.y * deltaYMm);

    const clampedSize = clampSize(
      {
        x: dir.x === 1 ? anchorX : doc.width_mm - anchorX,
        y: dir.y === 1 ? anchorY : doc.height_mm - anchorY,
        width: rawWidth,
        height: rawHeight,
      },
      doc,
    );

    // The anchor was already guaranteed in-bounds (it's the untouched
    // corner of a previously-clamped element), and clampedSize.width/height
    // can never exceed the room between the anchor and the board edge --
    // so the derived x/y below is always in-bounds too, with no separate
    // clampPosition call needed.
    const finalX = dir.x === 1 ? anchorX : anchorX - clampedSize.width;
    const finalY = dir.y === 1 ? anchorY : anchorY - clampedSize.height;

    onResize(el.id, clampedSize.width, clampedSize.height);
    if (finalX !== drag.startX || finalY !== drag.startY) {
      onMove(el.id, finalX, finalY);
    }
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.captureTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function handleArtboardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (selectedId) {
        // Swallow: the canvas owns deselect-on-Escape when something is
        // selected. Task 11's page-level dirty guard listens for Escape
        // too, but only for the "nothing is selected" case below -- this
        // is NOT that guard, and must not also trigger it in the same
        // keystroke.
        event.stopPropagation();
        onSelect(null);
      }
      // Nothing selected: don't preventDefault/stopPropagation -- let the
      // event bubble so Task 11's page-level listener can react.
      return;
    }

    const delta = ARROW_DELTA[event.key];
    if (!delta || !selectedId) return;
    const el = doc.elements.find((candidate) => candidate.id === selectedId);
    if (!el) return;

    event.preventDefault();
    const step = event.shiftKey ? NUDGE_MM_SHIFT : NUDGE_MM;
    // Same footprint fallback as the drag path (elementFootprint) -- NOT
    // raw el.width/el.height (undefined -> 0), which would let a nudge
    // slide a default-footprint element past where a drag of the same
    // element clamps. One footprint rule for both input paths.
    const { width, height } = elementFootprint(el);
    const next = clampPosition(
      { x: el.x + delta.dx * step, y: el.y + delta.dy * step, width, height },
      doc,
    );
    onMove(el.id, next.x, next.y);
  }

  return (
    // Fixed dark work surface -- theme-invariant by design; see
    // WORK_SURFACE_BG's exception comment above (the same sanctioned
    // physical-media exception as the white artboard face below).
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg p-4"
      style={{ backgroundColor: WORK_SURFACE_BG }}
      data-testid="badge-canvas"
    >
      <div
        ref={artboardRef}
        role="group"
        aria-label={t("badgeArtboardCaption", { w: doc.width_mm, h: doc.height_mm, dpi: doc.dpi })}
        tabIndex={0}
        onKeyDown={handleArtboardKeyDown}
        data-testid="badge-canvas-artboard"
        className="relative shrink-0 overflow-hidden rounded-md shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{
          width: boardWidthPx,
          height: boardHeightPx,
          // The ONE documented non-token-color exception for this
          // component (same pattern as QrSvg.tsx / print.css, referencing
          // the plan's own Global Constraints "token classes only" line
          // above): a physical badge's face is white paper/plastic
          // regardless of the app's light/dark theme. `bg-background`
          // would misrepresent the physical medium -- it's DARK in dark
          // mode (theme.css's `.dark { --background: #101012; }`) -- so a
          // literal white is deliberate here, not a lapse.
          backgroundColor: "#ffffff",
        }}
      >
        {doc.elements.map((el) => (
          <CanvasElement
            key={el.id}
            element={el}
            scale={scale}
            selected={el.id === selectedId}
            resolvedText={resolveElementText(el, previewData)}
            onSelect={() => selectByClick(el.id)}
            onPointerDownMove={(event) => beginMove(event, el)}
            onPointerMove={(event) => handlePointerMove(event, el)}
            onPointerUp={endDrag}
            onCornerPointerDown={(event, corner) => beginResize(event, el, corner)}
          />
        ))}
      </div>

      {/* Fixed caption neutrals on the fixed-dark surface -- see
          WORK_SURFACE_CAPTION*'s exception comment above. */}
      <p className="text-code" style={{ color: WORK_SURFACE_CAPTION }}>
        {t("badgeArtboardCaption", { w: doc.width_mm, h: doc.height_mm, dpi: doc.dpi })}
      </p>
      {/* Canvas render is an EDITING AID, not print truth (reconciliation
          #5) -- this stays visible permanently, not just for some
          first-run tip, so nobody mistakes this approximation for what
          actually prints until P3.2's real ZPL preview exists. */}
      <p className="text-caption" style={{ color: WORK_SURFACE_CAPTION_MUTED }}>
        {t("badgeCanvasApproximation")}
      </p>
    </div>
  );
}

interface CanvasElementProps {
  element: BadgeElement;
  scale: number;
  selected: boolean;
  resolvedText: string;
  onSelect: () => void;
  onPointerDownMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onCornerPointerDown: (event: React.PointerEvent<HTMLDivElement>, corner: Corner) => void;
}

function CanvasElement({
  element, scale, selected, resolvedText,
  onSelect, onPointerDownMove, onPointerMove, onPointerUp, onCornerPointerDown,
}: CanvasElementProps) {
  const { width, height } = elementFootprint(element);
  const style: React.CSSProperties = {
    position: "absolute",
    left: mmToPx(element.x, scale),
    top: mmToPx(element.y, scale),
    width: mmToPx(width, scale),
    height: mmToPx(height, scale),
  };

  return (
    <div
      data-testid={`badge-canvas-element-${element.id}`}
      onClick={onSelect}
      onPointerDown={onPointerDownMove}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={style}
      className={cn(
        // Deliberately NOT `overflow-hidden` here: the 4 corner resize
        // handles below are centered ON each corner point (half inside,
        // half outside this box) -- clipping overflow would cut them in
        // half. Content that needs truncation (text) handles its own
        // overflow inline instead.
        "cursor-move select-none touch-none",
        // Selected element: 2px accent outline + (below) 4 corner resize
        // handles. Handles are distinct SQUARE shapes, not a color-only
        // signal (WCAG non-color-alone), so selection stays perceivable
        // even under a color-vision deficiency.
        selected && "outline outline-2 outline-offset-1 outline-primary",
      )}
    >
      <ElementContent element={element} resolvedText={resolvedText} scale={scale} />
      {selected && CORNERS.map((corner) => (
        <ResizeHandle key={corner} elementId={element.id} corner={corner} onPointerDown={(event) => onCornerPointerDown(event, corner)} />
      ))}
    </div>
  );
}

function ElementContent({
  element, resolvedText, scale,
}: { element: BadgeElement; resolvedText: string; scale: number }) {
  const { t } = useTranslation();

  switch (element.type) {
    case "text": {
      const fontSizePt = element.fontSize ?? 12;
      const fontSizePx = Math.max(mmToPx(fontSizePt * MM_PER_POINT, scale), 6);
      return (
        <span
          className="block w-full truncate leading-none"
          // Fixed ink color -- see ARTBOARD_INK's exception comment above.
          style={{ fontSize: fontSizePx, textAlign: element.align ?? "left", color: ARTBOARD_INK }}
        >
          {resolvedText}
        </span>
      );
    }

    case "qrcode":
      // Real local QR rendering, reused as-is from the staff feature
      // (P2.2) -- same `qrcode` dep, same pure-JS/no-3rd-party-API
      // guarantee. `QrSvg` has no staff-specific coupling (just React +
      // `qrcode`), so it's cleanly importable cross-feature rather than
      // duplicated here.
      return (
        <QrSvg
          value={resolvedText}
          label={t("badgeQrCodeLabel", { value: resolvedText })}
          className="h-full w-full"
        />
      );

    case "barcode":
      // No barcode-rendering lib in this repo (YAGNI, per the plan) --
      // a striped placeholder block stands in for the real bars, with the
      // resolved value printed below in mono so the DATA is still
      // reviewable even though the visual isn't a real, scannable symbol.
      // `aria-label` carries the "approximation" honesty label as the
      // accessible name, not just a visual footnote.
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-0.5"
          aria-label={t("badgeBarcodeApproximation")}
        >
          <div
            className="h-2/3 w-full"
            // Fixed ink stripes -- see ARTBOARD_INK's exception comment.
            style={{
              backgroundImage:
                `repeating-linear-gradient(90deg, ${ARTBOARD_INK} 0px, ${ARTBOARD_INK} 2px, transparent 2px, transparent 4px)`,
            }}
            aria-hidden
          />
          <span
            className="w-full truncate px-0.5 text-center font-mono text-[9px]"
            style={{ color: ARTBOARD_INK_MUTED }}
          >
            {resolvedText}
          </span>
        </div>
      );

    case "line":
    case "box":
      // Both render as simple bordered divs per the brief -- a "line" is
      // just a very thin box in this format (zpl.go's own generator draws
      // both with the same `^GB` graphic-box command). Fixed ink border --
      // see ARTBOARD_INK's exception comment above.
      return <div className="h-full w-full border-2" style={{ borderColor: ARTBOARD_INK }} aria-hidden />;

    default:
      return null;
  }
}

const CORNER_POSITION: Record<Corner, { left: string; top: string }> = {
  nw: { left: "0%", top: "0%" },
  ne: { left: "100%", top: "0%" },
  sw: { left: "0%", top: "100%" },
  se: { left: "100%", top: "100%" },
};

const CORNER_CURSOR: Record<Corner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

function ResizeHandle({
  elementId, corner, onPointerDown,
}: { elementId: string; corner: Corner; onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  const position = CORNER_POSITION[corner];
  return (
    <div
      data-testid={`badge-canvas-handle-${elementId}-${corner}`}
      onPointerDown={onPointerDown}
      className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-primary bg-background"
      style={{ left: position.left, top: position.top, cursor: CORNER_CURSOR[corner] }}
    />
  );
}
