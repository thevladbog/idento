// P3.2 Task 2 -- Cyrillic coverage flags for uploaded event fonts.
//
// web's client-side ZPL pipeline (web/src/lib/fonts.ts / web/src/utils/
// zpl-image-text.ts) never checked font coverage at all (plan reconciliation
// #3): its raster path just draws whatever glyph the browser falls back to
// when a font is missing a character -- silently producing a wrong printed
// badge with no signal to the operator. `checkCyrillicCoverage` is the new
// capability that closes that gap: parse the font's real cmap with
// opentype.js and confirm every sample character actually resolves to a
// glyph, rather than assuming.
import { useQueries } from "@tanstack/react-query";
import * as opentype from "opentype.js";
import { api } from "../../../shared/api/http";
import { $api } from "../../../shared/api/query";

// Sample set verbatim from the task brief: spans the Cyrillic alphabet's
// visual range (А...Я) plus the three glyphs (ы/ё/я) most likely to be
// missing from a partial/Latin-extended subset font.
const CYRILLIC_SAMPLE = "АЯЁЖЩыёя";

/**
 * True only if the font resolves EVERY character of the sample set to a
 * real glyph (`charToGlyphIndex > 0` -- index 0 is opentype.js's `.notdef`
 * fallback for an unmapped code point, never a genuine glyph). Throws if
 * `fontBytes` isn't a parseable font file at all; callers must catch that
 * (see `useFontCoverage` below) and expose `undefined`, never treat a parse
 * failure as "no coverage" -- a `false` reads identically to a real
 * Latin-only font in the UI, which would be a false negative on a totally
 * different failure mode (a corrupt upload, not a font design choice).
 */
export function checkCyrillicCoverage(fontBytes: ArrayBuffer): boolean {
  const font = opentype.parse(fontBytes);
  return [...CYRILLIC_SAMPLE].every((ch) => font.charToGlyphIndex(ch) > 0);
}

/**
 * Per-font Cyrillic-coverage flags for one event's uploaded fonts, keyed by
 * font id. `undefined` covers BOTH "still loading" and "failed to fetch/
 * parse" -- deliberately never collapsed to `false`, so a consumer (Task 4's
 * font selector) can never render a coverage flag it can't actually back up.
 *
 * Each font's bytes are fetched + parsed as their own TanStack Query
 * (`useQueries`, one per font) so one slow/corrupt font can't block the
 * others' flags from resolving, and each parse result is cached rather than
 * re-parsed on every render. Bytes are fetched through the shared `api`
 * client (not a bare `fetch`) so the auth middleware in shared/api/http.ts
 * applies -- `GET /api/fonts/{id}/file` requires a Bearer token like every
 * other /api/* route despite its route-registration comment suggesting
 * otherwise (verified against schema.d.ts's operation doc). `retry: false`:
 * an unparseable file is deterministically unparseable, so retrying can't
 * change the outcome, only slow the UI down.
 */
export function useFontCoverage(eventId: string): Record<string, boolean | undefined> {
  const fontsQuery = $api.useQuery("get", "/api/events/{event_id}/fonts", {
    params: { path: { event_id: eventId } },
  });
  const fonts = fontsQuery.data ?? [];

  const coverageQueries = useQueries({
    queries: fonts.map((font) => ({
      queryKey: ["badge", "fontCoverage", font.id] as const,
      queryFn: async (): Promise<boolean> => {
        const { data } = await api.GET("/api/fonts/{id}/file", {
          params: { path: { id: font.id } },
          parseAs: "arrayBuffer",
        });
        if (!data) {
          throw new Error(`Empty response fetching font bytes for font ${font.id}`);
        }
        return checkCyrillicCoverage(data);
      },
      retry: false,
    })),
  });

  const coverage: Record<string, boolean | undefined> = {};
  fonts.forEach((font, index) => {
    coverage[font.id] = coverageQueries[index]?.data;
  });
  return coverage;
}
