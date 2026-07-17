// PR #74 review round Fix 8 -- shared helper for detecting badge elements
// whose `customFont` family isn't among the event's currently-loaded custom
// fonts (useEventFontFaces' `families`).
//
// A template can reference a customFont family that no longer resolves to
// an uploaded font (the font was deleted from the event after the template
// was last saved, or the family name was hand-edited into something that
// never matched an upload). generateZpl's raster branch (generateZpl.ts's
// `needsImageRendering`/`customFont` handling) does NOT detect this itself:
// the browser's Canvas 2D API silently substitutes a fallback font for an
// unregistered family and rasterizes THAT instead, producing a legible-
// looking but WRONG bitmap with no error at all. Every print-sending
// surface (drawer reprint, bulk print, test print -- see usePrintBadge.ts's
// `MissingFontError` and each surface's own missing-font handling) runs
// this check BEFORE generation so a genuinely wrong badge is never handed
// to a physical printer silently. ZplPreviewModal.tsx uses it too, but only
// to WARN (never block) -- a preview rendering a fallback glyph is honest
// enough for on-screen review; only a PHYSICAL print must be stopped.
import type { RawBadgeElement } from "./generateZpl";

/**
 * The DISTINCT, trimmed `customFont` families referenced by `elements` that
 * are NOT present in `loadedFamilies` (an event's currently successfully-
 * loaded custom fonts, per `useEventFontFaces`' `families`). Order matches
 * each family's first appearance in `elements`; a family is never repeated
 * even if multiple elements reference it. Elements with no `customFont` (or
 * an all-whitespace one) are ignored entirely -- they use a built-in ZPL/
 * system font, which is always available and never checked here.
 */
export function collectMissingCustomFonts(
  elements: readonly RawBadgeElement[],
  loadedFamilies: readonly string[],
): string[] {
  const loaded = new Set(loadedFamilies);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const element of elements) {
    const family = element.customFont?.trim();
    if (!family) continue;
    if (loaded.has(family)) continue;
    if (seen.has(family)) continue;
    seen.add(family);
    missing.push(family);
  }
  return missing;
}
