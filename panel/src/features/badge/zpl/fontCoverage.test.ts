// P3.2 Task 2 -- Cyrillic coverage tests.
//
// Fixture strategy (per the task brief, preferred approach): build TWO fonts
// WITH opentype.js itself, in-memory, right here -- a `.notdef` glyph plus
// one trivial-outline glyph per character we want "covered", then
// `font.toArrayBuffer()` to get real, parseable OpenType bytes. This avoids
// committing an opaque base64 blob with no verifiable provenance; every
// fixture byte here is fully explained by the construction code below.
// Construction proved NOT flaky (verified with a throwaway `node -e` smoke
// test against the installed opentype.js@2.0.0 before writing this file), so
// the base64-fixture fallback the brief allows for was not needed.
import * as opentype from "opentype.js";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createElement, type ReactNode } from "react";
import { checkCyrillicCoverage, useFontCoverage } from "./fontCoverage";
import { startMswServer } from "../../../test/msw";

// The brief's sample set verbatim: every character here must resolve to a
// nonzero glyph index for `checkCyrillicCoverage` to report `true`.
const CYRILLIC_SAMPLE = "АЯЁЖЩыёя";

// Builds a minimal valid OpenType font in-memory: a required `.notdef` at
// glyph index 0 (empty path -- the OpenType spec requires this glyph to
// exist, it's never itself looked up by `charToGlyphIndex`) plus one
// trivial-square-outline glyph per character in `chars`, each mapped to its
// codepoint via `unicode`. `font.toArrayBuffer()` produces real bytes that
// `opentype.parse` can round-trip.
function buildFont(chars: string): ArrayBuffer {
  const notdefGlyph = new opentype.Glyph({
    name: ".notdef",
    advanceWidth: 650,
    path: new opentype.Path(),
  });

  const glyphs: opentype.Glyph[] = [notdefGlyph];
  for (const ch of chars) {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.lineTo(300, 0);
    path.lineTo(300, 300);
    path.lineTo(0, 300);
    path.close();
    glyphs.push(
      new opentype.Glyph({
        name: `g${ch.codePointAt(0)}`,
        unicode: ch.codePointAt(0),
        advanceWidth: 650,
        path,
      }),
    );
  }

  const font = new opentype.Font({
    familyName: "CoverageTestFont",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });

  return font.toArrayBuffer();
}

describe("checkCyrillicCoverage", () => {
  it("returns true when the font covers every sample character", () => {
    const bytes = buildFont(CYRILLIC_SAMPLE);
    expect(checkCyrillicCoverage(bytes)).toBe(true);
  });

  it("returns false for a Latin-only font", () => {
    const bytes = buildFont("ABCDEFGHIJKLMNOP");
    expect(checkCyrillicCoverage(bytes)).toBe(false);
  });

  it("returns false when even one sample character is missing (partial subset)", () => {
    // Every sample character except the final "я".
    const bytes = buildFont("АЯЁЖЩыё");
    expect(checkCyrillicCoverage(bytes)).toBe(false);
  });

  it("throws on unparseable garbage bytes (caller/hook must catch this)", () => {
    const garbage = new TextEncoder().encode("not a font file, just garbage bytes 12345").buffer;
    expect(() => checkCyrillicCoverage(garbage)).toThrow();
  });
});

function fontListItem(id: string, family: string, size: number) {
  return {
    id,
    name: family,
    family,
    weight: "normal",
    style: "normal",
    format: "opentype" as const,
    size,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const CYR_BYTES = buildFont(CYRILLIC_SAMPLE);
const LATIN_BYTES = buildFont("ABCDEFG");
const GARBAGE_BYTES = new TextEncoder().encode("garbage, not a font").buffer;

// Per-font-id fetch counter — lets the staleTime test below prove a
// RESOLVED font's bytes are never re-fetched (and so never re-parsed) on
// window refocus, per id rather than as one aggregate that the errored
// garbage font (which TanStack legitimately retries on refocus — an error
// query has no fresh data for staleTime to protect) would muddy.
let fontFileHits: Record<string, number> = {};

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/fonts", () => {
    return HttpResponse.json([
      fontListItem("font-cyr", "CyrFont", CYR_BYTES.byteLength),
      fontListItem("font-latin", "LatinFont", LATIN_BYTES.byteLength),
      fontListItem("font-garbage", "GarbageFont", GARBAGE_BYTES.byteLength),
    ]);
  }),
  http.get("http://api.test/api/fonts/:id/file", ({ params }) => {
    const id = params.id as string;
    fontFileHits[id] = (fontFileHits[id] ?? 0) + 1;
    switch (id) {
      case "font-cyr":
        return HttpResponse.arrayBuffer(CYR_BYTES);
      case "font-latin":
        return HttpResponse.arrayBuffer(LATIN_BYTES);
      default:
        return HttpResponse.arrayBuffer(GARBAGE_BYTES);
    }
  }),
);
void server;

// `createElement` rather than JSX: this file is plain `.ts` (not `.tsx`, per
// the task brief's file list), and JSX syntax isn't valid in a `.ts` module.
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("useFontCoverage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    fontFileHits = {};
  });

  it("resolves true/false/undefined per font -- never a false positive for an unparseable file", async () => {
    const { result } = renderHook(() => useFontCoverage("evt-1"), { wrapper });

    await waitFor(() => {
      expect(result.current["font-cyr"]).toBe(true);
      expect(result.current["font-latin"]).toBe(false);
    });

    // Give the garbage-font query a chance to settle into "error" too, then
    // assert it stays `undefined` forever -- never collapses to `false`.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(result.current["font-garbage"]).toBeUndefined();
  });

  // Follow-up batch item 3: font bytes are immutable per id (an uploaded
  // font is never edited in place — a change is a new upload with a new id),
  // so a window refocus must not re-fetch AND re-parse every resolved event
  // font (the default staleTime of 0 marked them instantly stale, so every
  // refocus re-downloaded and re-ran opentype.parse over each one).
  it("does not re-fetch (or re-parse) a resolved font's bytes on window refocus — bytes per id are immutable", async () => {
    const { result } = renderHook(() => useFontCoverage("evt-1"), { wrapper });
    await waitFor(() => {
      expect(result.current["font-cyr"]).toBe(true);
      expect(result.current["font-latin"]).toBe(false);
    });
    expect(fontFileHits["font-cyr"]).toBe(1);
    expect(fontFileHits["font-latin"]).toBe(1);

    // Simulate the tab losing and regaining focus via TanStack's own focus
    // seam (jsdom can't produce a real visibilitychange round-trip).
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    // Give any (incorrect) refocus refetch a chance to fire before
    // asserting its absence.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(fontFileHits["font-cyr"]).toBe(1);
    expect(fontFileHits["font-latin"]).toBe(1);

    // Restore the default "track real focus events" behavior for other tests.
    focusManager.setFocused(undefined);
  });
});
