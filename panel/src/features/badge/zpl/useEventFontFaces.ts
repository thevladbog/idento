// P3.2 Task 2 -- event font-faces runtime.
//
// Ports web/src/lib/fonts.ts:84-110's `loadEventFonts` (fetch the event's
// fonts list -> `new FontFace(family, url(...), {weight, style})` -> `await
// load()` -> `document.fonts.add(fontFace)`), with one deliberate fix over
// web (plan reconciliation #9): web fires `loadEventFonts` un-awaited from a
// `useEffect`, so a print/preview action started immediately after can (and
// in practice sometimes does) run before the fonts have actually loaded,
// silently rasterizing the browser's fallback glyphs into the printed
// bitmap. This hook instead exposes an explicit, pollable `status` so a
// generation path can `await` (or gate on) `status === "ready"` before it
// ever calls the ZPL generator.
import * as React from "react";
import { getApiBaseUrl } from "../../../shared/api/http";
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
  const loadedEventRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const fonts = fontsQuery.data;
    if (!fonts) return;
    if (loadedEventRef.current === eventId) return;
    if (typeof FontFace === "undefined") return;

    loadedEventRef.current = eventId;
    let cancelled = false;
    setStatus("loading");
    setFamilies([]);

    // `fonts` is passed in as a parameter (rather than closed over directly)
    // so it keeps its narrowed (non-`undefined`) type inside this nested
    // function -- TS's control-flow narrowing above does not extend into a
    // hoisted `function` declaration's body, even for a `const` capture.
    async function loadAll(loadableFonts: FontListItem[]) {
      const loadedFamilies: string[] = [];
      let anyFailed = false;

      for (const font of loadableFonts) {
        const fontUrl = `${getApiBaseUrl()}/api/fonts/${font.id}/file`;
        try {
          const fontFace = new FontFace(font.family, `url(${fontUrl})`, {
            weight: font.weight,
            style: font.style,
          });
          await fontFace.load();
          if (cancelled) return;
          document.fonts.add(fontFace);
          loadedFamilies.push(font.family);
        } catch {
          // Per-font isolation: one font failing to load must not stop the
          // others from being tried and added -- only flip the overall
          // status to "error" once every font has had its chance.
          anyFailed = true;
        }
      }

      if (cancelled) return;
      setFamilies(loadedFamilies);
      setStatus(anyFailed ? "error" : "ready");
    }

    void loadAll(fonts);

    return () => {
      cancelled = true;
    };
  }, [enabled, eventId, fontsQuery.data]);

  return { status, families };
}
