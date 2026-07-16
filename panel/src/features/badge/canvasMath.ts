// Pure geometry/text-resolution helpers for the badge canvas (P3.1 Task 8).
// No React import, no side effects. BadgeCanvas.tsx routes EVERY mm<->px
// conversion and every position/size clamp through these functions rather
// than re-deriving the same arithmetic inline, so drag/resize math has
// exactly one source of truth and is fully unit-tested here in isolation.
import type { BadgeConfig, BadgeElement, BadgeElementType } from "./templateTypes";

// UI-only fallback footprints for element types that can end up with no
// explicit width/height in the stored template. Only `text` ever omits
// both by design (ElementsPane's ELEMENT_DEFAULTS always sets width/height
// for qrcode/barcode/line/box) -- these exist so a hand-edited or legacy
// doc still renders a sane, clickable/selectable box rather than a
// zero-size element. Several numbers deliberately match zpl.go's own
// GENERATION-time fallbacks (qrcode 20mm, barcode height 10mm, box/line
// width 10mm -- see generateQRCodeZPL/generateBarcodeZPL/generateLineZPL/
// generateBoxZPL) since those are the closest available "reasonable
// default" precedent; the rest (text, line height) are this editor's own
// UI-only choices with no backend equivalent.
export const DEFAULT_SIZE_MM: Record<BadgeElementType, { width: number; height: number }> = {
  text: { width: 40, height: 8 },
  qrcode: { width: 20, height: 20 },
  barcode: { width: 30, height: 10 },
  line: { width: 10, height: 1 },
  box: { width: 10, height: 10 },
};

// One footprint rule for EVERY input path that positions or sizes an
// element -- canvas drag, keyboard nudge (both in BadgeCanvas.tsx), and the
// properties pane's typed X/Y/Width/Height (PropertiesPane.tsx) all resolve
// an element's effective size through THIS helper before clamping, so a
// width/height-less element clamps to the same bounds everywhere it can be
// moved or resized. (Clamping a raw `width ?? 0` instead would let one
// input path park the element's rendered box past the artboard edge that
// another path enforces.)
export function elementFootprint(el: Pick<BadgeElement, "type" | "width" | "height">): { width: number; height: number } {
  const fallback = DEFAULT_SIZE_MM[el.type];
  return { width: el.width ?? fallback.width, height: el.height ?? fallback.height };
}

/** Millimeters -> canvas pixels at the given scale (pixels per millimeter). */
export function mmToPx(mm: number, scale: number): number {
  return mm * scale;
}

/** Canvas pixels -> millimeters at the given scale (pixels per millimeter). */
export function pxToMm(px: number, scale: number): number {
  return px / scale;
}

// Breathing room (px) kept between the artboard and the edge of its
// notional viewport on every side — mirrors the board's own artboard
// framing (§4a: the 432x264px board sits inside a larger dark canvas pane
// with visible margin around it on every side).
const FIT_MARGIN_PX = 24;

// Upper bound on px-per-mm so a very small (or extreme-aspect-ratio) label
// never blows up to an absurd on-screen pixel size just because the
// viewport happens to be large relative to it.
const MAX_SCALE_PX_PER_MM = 8;

/**
 * The px-per-mm scale that fits `config`'s label size inside `viewportPx`
 * with FIT_MARGIN_PX of margin on every side (fit-with-margin), capped at
 * MAX_SCALE_PX_PER_MM so an extreme aspect ratio in an oversized viewport
 * can't produce a huge scale. For the board's own reference numbers -- a
 * 90x55mm label inside a 480x312px viewport -- this resolves to exactly
 * (480 - 2*24) / 90 = (312 - 2*24) / 55 = 4.8 px/mm, matching the board's
 * 432x264px artboard depiction (90*4.8=432, 55*4.8=264).
 */
export function fitScale(config: BadgeConfig, viewportPx: { w: number; h: number }): number {
  const availableW = Math.max(viewportPx.w - 2 * FIT_MARGIN_PX, 1);
  const availableH = Math.max(viewportPx.h - 2 * FIT_MARGIN_PX, 1);
  const fitted = Math.min(availableW / config.width_mm, availableH / config.height_mm);
  return Math.min(fitted, MAX_SCALE_PX_PER_MM);
}

// Both clamp functions accept just the position/size fields they need
// (rather than a full BadgeElement) so callers can clamp a candidate
// {x, y}/{width, height} pair mid-drag without constructing a whole element.
type PositionInput = Pick<BadgeElement, "x" | "y" | "width" | "height">;
type SizeInput = Pick<BadgeElement, "x" | "y" | "width" | "height">;

/**
 * Clamps an element's x/y so its footprint (`width`/`height`, defaulting to
 * 0 when the element type carries no explicit size -- e.g. a plain text
 * element) stays fully inside the label's [0, width_mm] x [0, height_mm]
 * bounds: a negative position clamps to 0, and a position that would push
 * the element past the far edge clamps to the largest value that still
 * fits (`config dimension - element footprint`, i.e. max-fitting). Callers
 * (BadgeCanvas's drag handler) apply this BEFORE dispatching "move" -- the
 * editorState reducer stores whatever it's given, verbatim.
 */
export function clampPosition(el: PositionInput, config: BadgeConfig): { x: number; y: number } {
  const maxX = Math.max(config.width_mm - (el.width ?? 0), 0);
  const maxY = Math.max(config.height_mm - (el.height ?? 0), 0);
  return {
    x: Math.min(Math.max(el.x, 0), maxX),
    y: Math.min(Math.max(el.y, 0), maxY),
  };
}

/**
 * Clamps an element's width/height so it never shrinks below `minMm` and
 * never grows past however much room is left between the element's
 * current x/y and the label's far edge -- resizing can't push the
 * element's far edge outside the artboard. Callers apply this BEFORE
 * dispatching "resize".
 */
export function clampSize(el: SizeInput, config: BadgeConfig, minMm = 1): { width: number; height: number } {
  const maxWidth = Math.max(config.width_mm - el.x, minMm);
  const maxHeight = Math.max(config.height_mm - el.y, minMm);
  return {
    width: Math.min(Math.max(el.width ?? minMm, minMm), maxWidth),
    height: Math.min(Math.max(el.height ?? minMm, minMm), maxHeight),
  };
}

/**
 * Resolves an element's rendered text against attendee `data`. Mirrors
 * backend/internal/zpl/zpl.go:172-177's generateTextZPL EXACTLY (the same
 * rule the QR/barcode generators repeat at their own call sites,
 * zpl.go's generateQRCodeZPL/generateBarcodeZPL):
 *
 *   textContent := el.Text
 *   if el.Source != "" {
 *     if v := getDataString(data, el.Source); v != "" {
 *       textContent = v
 *     }
 *   }
 *
 * i.e. a non-empty `source` wins ONLY when `data[source]` itself resolves
 * non-empty; an empty/absent data value falls back to the static `text`
 * (never renders blank when a fallback exists), and no `source` at all
 * also falls back to `text` (or "" when neither is set).
 */
export function resolveElementText(
  el: Pick<BadgeElement, "text" | "source">,
  data: Record<string, string>,
): string {
  if (el.source) {
    const value = data[el.source];
    if (value !== undefined && value !== "") return value;
  }
  return el.text ?? "";
}

/**
 * True exactly when `el.source` is set but does NOT resolve for `data` --
 * i.e. resolveElementText(el, data) is about to fall back to the static
 * `text` for a BOUND element (an unbound element, or one whose source
 * resolves fine, is never "missing"). P3.1 Task 12's per-element preview
 * hint: BadgeCanvas uses this to flag the element with a `badgePreviewMissing`
 * title tooltip so a missing custom-field value on the previewed attendee
 * reads as "this binding has nothing to show right now", not as a genuinely
 * blank design choice (spec §6 "never invented values" -- the flip side of
 * that rule is also never letting a fallen-back-to-empty render pass as
 * silently intentional).
 */
export function isBindingUnresolved(
  el: Pick<BadgeElement, "source">,
  data: Record<string, string>,
): boolean {
  if (!el.source) return false;
  const value = data[el.source];
  return value === undefined || value === "";
}
