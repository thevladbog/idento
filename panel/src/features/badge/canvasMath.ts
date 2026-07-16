// Pure geometry/text-resolution helpers for the badge canvas (P3.1 Task 8).
// No React import, no side effects. BadgeCanvas.tsx routes EVERY mm<->px
// conversion and every position/size clamp through these functions rather
// than re-deriving the same arithmetic inline, so drag/resize math has
// exactly one source of truth and is fully unit-tested here in isolation.
import type { BadgeConfig, BadgeElement } from "./templateTypes";

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
