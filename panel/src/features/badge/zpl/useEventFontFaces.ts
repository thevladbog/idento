// P3.2 Task 2 -- event font-faces runtime.
//
// Ports web/src/lib/fonts.ts:84-110's `loadEventFonts` (fetch the event's
// fonts list -> FontFace -> `await load()` -> `document.fonts.add(fontFace)`)
// with TWO deliberate fixes over web:
//
// 1. (plan reconciliation #9) web fires `loadEventFonts` un-awaited from a
//    `useEffect`, so a print/preview action started immediately after can
//    (and in practice sometimes does) run before the fonts have actually
//    loaded, silently rasterizing the browser's fallback glyphs into the
//    printed bitmap. This hook instead exposes an explicit, pollable
//    `status` so a generation path can `await` (or gate on) `status ===
//    "ready"` before it ever calls the ZPL generator.
// 2. web constructs `new FontFace(family, "url(.../api/fonts/{id}/file)")`,
//    which makes the BROWSER fetch the font bytes itself -- an internal
//    fetch that carries no Authorization header. But that endpoint is NOT
//    public: it's registered inside the JWT-gated `/api` group
//    (backend/internal/handler/handler.go:55 `api.Use(middleware.JWT())`,
//    :159 the route itself -- its "Public font file endpoint" comment is
//    wrong), so web's url() approach 401s against it. This hook instead
//    fetches the bytes through the shared authenticated `api` client (the
//    exact pattern fontCoverage.ts already uses for the same endpoint) and
//    hands the resulting ArrayBuffer straight to the FontFace constructor
//    (`new FontFace(family, source)` accepts BinaryData per lib.dom.d.ts).
import * as React from "react";
import { api } from "../../../shared/api/http";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

// Same alias FontsCard.tsx uses for this exact schema type.
type FontListItem = components["schemas"]["FontListItem"];

export type EventFontFacesStatus = "idle" | "loading" | "ready" | "error";

export interface UseEventFontFacesResult {
  status: EventFontFacesStatus;
  families: string[];
}

/**
 * Loads an event's uploaded fonts into `document.fonts` so the badge canvas/
 * ZPL raster path can actually render them. `enabled` gates the whole thing
 * off (no fonts-list fetch, no FontFace loading) for surfaces that don't
 * need Cyrillic/custom-font rendering -- only print/preview surfaces pass
 * `true`.
 *
 * Loads once per `eventId` (`loadedEventRef`, NOT a module-level cache --
 * scoped to this hook instance on purpose: each print/preview surface
 * mounts its own instance and manages its own load, so re-opening a surface
 * re-loads fresh rather than trusting a load some other surface did). A
 * re-render with the SAME `eventId` (e.g. the fonts-list query background-
 * refetching, or an unrelated parent re-render) does NOT re-run the load;
 * only an actual `eventId` change does.
 *
 * jsdom implements neither `FontFace` nor `document.fonts` (verified
 * empirically -- `"FontFace" in window` is `false` there). Rather than
 * crashing every test that mounts a print/preview surface, this hook treats
 * a missing `FontFace` constructor as a documented idle state: `status`
 * simply never leaves `"idle"`. Real browsers all implement the CSS Font
 * Loading API, so this guard is a test-environment concession, not a
 * feature-detection fallback path real users hit.
 */
export function useEventFontFaces(eventId: string, enabled: boolean): UseEventFontFacesResult {
  const fontsQuery = $api.useQuery(
    "get",
    "/api/events/{event_id}/fonts",
    { params: { path: { event_id: eventId } } },
    { enabled },
  );

  const [status, setStatus] = React.useState<EventFontFacesStatus>("idle");
  const [families, setFamilies] = React.useState<string[]>([]);
  // PR #74 review round Fix 4: the guard used to be "have we already loaded
  // for THIS eventId" (a plain `string | null`), which made a fonts-list
  // refetch that adds/removes a font a permanent no-op for the rest of the
  // event's session -- the new font would never load. It's now keyed on a
  // LOADED SIGNATURE (the current list's font ids, sorted+joined) so a
  // genuine list change is detected and triggers a delta reload below,
  // while a background refetch that returns the SAME id set (the common
  // case) still short-circuits exactly like the old once-per-event guard
  // did.
  const loadedSignatureRef = React.useRef<string | null>(null);
  // Per-font-id bookkeeping for the delta reload: which ids have ALREADY
  // had a FontFace constructed+load attempted (success or failure), and
  // each one's outcome (its family on success, or `null` on failure). A
  // signature change only needs to process ids NOT already in this map --
  // re-processing an already-loaded font would construct a second,
  // redundant FontFace for the exact same family and double-count it.
  // Reset (along with `loadedSignatureRef`) whenever `eventId` itself
  // changes, by the effect below.
  const processedFontsRef = React.useRef<Map<string, string | null>>(new Map());
  // Whether a load has ever been kicked off for the CURRENT eventId
  // (regardless of the exact signature) -- preserves the original
  // "a failed BACKGROUND refetch after a successful load must not flip an
  // already-ready surface to a false warning" rule from before Fix 4, which
  // cared about "loaded this event before", not the finer-grained font-id
  // signature.
  const hasLoadedForEventRef = React.useRef(false);

  // PR #74 review round Fix 3: without this, `status`/`families` from the
  // PREVIOUS event would keep reading through render(s) after `eventId`
  // changes but before the main effect below has a chance to run its own
  // load for the NEW event -- a consumer gated on `status === "ready"`
  // (e.g. a print action) could momentarily treat the previous event's
  // already-loaded fonts as if they belonged to this one. Declared BEFORE
  // the main load effect so it always runs first for the same eventId
  // change (React runs an update's passive effects in declaration order),
  // resetting every piece of per-event state before the main effect's own
  // guard/load logic evaluates it.
  React.useEffect(() => {
    setStatus("idle");
    setFamilies([]);
    loadedSignatureRef.current = null;
    processedFontsRef.current = new Map();
    hasLoadedForEventRef.current = false;
  }, [eventId]);

  React.useEffect(() => {
    if (!enabled) return;
    // Task 5 review Important 3: the fonts-LIST query itself failing (500,
    // network error) leaves `data` undefined forever, so without this branch
    // the hook would sit on "idle" permanently -- and generation surfaces
    // (ZplPreviewModal) that await a TERMINAL status ("ready" | "error")
    // would wedge on their loading placeholder. A failed list maps to the
    // same "error" status a failed individual font load produces (families
    // stays [] -- nothing loaded), so consumers warn visibly and proceed
    // native-only. Deliberately gated BEHIND hasLoadedForEventRef: a failed
    // BACKGROUND refetch after a successful load must not flip an
    // already-"ready" surface to a false warning (react-query retains the
    // loaded data; the fonts are already in document.fonts). If the query
    // later recovers (retry/refetch succeeds), `data` arrives, `isError`
    // clears, and the load below runs normally -- error is not a dead end.
    if (fontsQuery.isError) {
      if (hasLoadedForEventRef.current) return;
      setStatus("error");
      setFamilies([]);
      return;
    }
    const fonts = fontsQuery.data;
    if (!fonts) return;
    if (typeof FontFace === "undefined") return;

    // PR #74 review round Fix 4: the loaded-signature guard. Same id set as
    // last time (the common case: a background refetch of unchanged data,
    // or a re-render with nothing new) -- nothing to do. A different set
    // (a font was added or removed) proceeds into the delta reload below.
    const signature = [...fonts].map((font) => font.id).sort().join(",");
    if (loadedSignatureRef.current === signature) return;

    hasLoadedForEventRef.current = true;
    loadedSignatureRef.current = signature;
    let cancelled = false;
    setStatus("loading");

    // Only the ids NOT already processed need a fresh FontFace -- an
    // already-loaded font is left exactly as-is in `document.fonts` (no
    // reconstruction, no re-`add`). A font that disappeared from the
    // CURRENT list simply isn't included in `fonts` below, so its family is
    // naturally dropped from this hook's `families` output -- its FontFace
    // object may still linger in `document.fonts` (there's no browser API
    // to selectively evict one), which is harmless: nothing in this app
    // renders/prints a family the CURRENT template doesn't ask for.
    const newFonts = fonts.filter((font) => !processedFontsRef.current.has(font.id));

    // `fonts` is passed in as a parameter (rather than closed over directly)
    // so it keeps its narrowed (non-`undefined`) type inside this nested
    // function -- TS's control-flow narrowing above does not extend into a
    // hoisted `function` declaration's body, even for a `const` capture.
    async function loadDelta(loadableFonts: FontListItem[], allFonts: FontListItem[]) {
      for (const font of loadableFonts) {
        try {
          // Authenticated bytes fetch -- NOT a url() source; see fix #2 in
          // the module comment. Non-2xx throws ApiError via the shared
          // client's errors middleware, landing in this font's catch below.
          const { data } = await api.GET("/api/fonts/{id}/file", {
            params: { path: { id: font.id } },
            parseAs: "arrayBuffer",
          });
          if (cancelled) return;
          if (!data) {
            throw new Error(`Empty response fetching font bytes for font ${font.id}`);
          }
          const fontFace = new FontFace(font.family, data, {
            weight: font.weight,
            style: font.style,
          });
          // With a BinaryData source the font is parsed at construction;
          // load() still resolves/rejects with the parse outcome, so this
          // await surfaces corrupt-bytes failures the same way url()
          // network failures surfaced before.
          await fontFace.load();
          if (cancelled) return;
          document.fonts.add(fontFace);
          processedFontsRef.current.set(font.id, font.family);
        } catch {
          // Per-font isolation: one font failing to fetch/parse/load must
          // not stop the others from being tried -- and it's recorded as a
          // (family-less) failure so it isn't retried on a future delta.
          processedFontsRef.current.set(font.id, null);
        }
      }

      if (cancelled) return;
      // Recompute the reported `families`/status from the FULL current
      // list (not just this delta's own fonts), so a delta reload's result
      // still reflects every font this event currently has -- previously-
      // loaded ones included, not just the newly-added one.
      const currentFamilies: string[] = [];
      let anyFailed = false;
      for (const font of allFonts) {
        const family = processedFontsRef.current.get(font.id);
        if (family) currentFamilies.push(family);
        else anyFailed = true;
      }
      setFamilies(currentFamilies);
      setStatus(anyFailed ? "error" : "ready");
    }

    void loadDelta(newFonts, fonts);

    return () => {
      cancelled = true;
    };
  }, [enabled, eventId, fontsQuery.data, fontsQuery.isError]);

  return { status, families };
}
