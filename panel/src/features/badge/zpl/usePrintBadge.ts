// P3.2 Task 8 -- the shared print-one-attendee flow: template fetch ->
// generate -> agent print -> mark-printed -> cache invalidation. This is the
// ONE home for that pipeline; the drawer's Reprint button (this task) and
// Task 9's bulk "Print badges" loop both call `printAttendee` rather than
// each re-deriving their own copy of it.
//
// Reconciliation #13 (docs/superpowers/plans/2026-07-16-panel-p3.2-print-
// truth.md): unlike the editor's TestPrintDialog/ZplPreviewModal (which
// generate from the LIVE, possibly-unsaved editor doc via
// serializeTemplateDoc), this hook generates from the event's SAVED SERVER
// template -- `GET /api/events/{id}/badge-template`'s raw `template` object,
// consumed directly (no parseTemplateDoc narrowing -- that's the editor's
// own defensive-rendering concern, not relevant to a doc that's already
// been validated server-side by zpl.ParseBadgeTemplate at save time) --
// plus `attendeeToPreviewData(attendee)`, matching backend/internal/
// handler/badge_zpl.go's own data map exactly.
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBadgeTemplate } from "../hooks";
import { attendeeToPreviewData } from "../usePreviewAttendee";
import type { BadgeConfig } from "../templateTypes";
import { generateZpl, type RawBadgeElement } from "./generateZpl";
import { rasterizeText } from "./canvasRasterizer";
import { useEventFontFaces } from "./useEventFontFaces";
import { ATTENDEES_LIST_KEY, ATTENDEE_DETAIL_KEY } from "../../attendees/hooks";
import { agentClient } from "../../../shared/agent/agentClient";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

/** Thrown when the event has no badge template yet (`template` is null) -- generation never starts, the agent is never called. */
export class NoTemplateError extends Error {
  constructor() {
    super("This event has no badge template yet.");
    this.name = "NoTemplateError";
  }
}

/**
 * Thrown when the badge was successfully SENT to the printer (agentClient.print
 * resolved) but the `POST /attendees/{id}/printed` increment afterward
 * failed. Non-fatal from the operator's perspective -- the physical send
 * already happened -- but callers must show a DIFFERENT (softer) message
 * than a genuine print failure: conflating the two would be dishonest about
 * what actually succeeded. The send is never retried when this happens.
 */
export class MarkPrintedError extends Error {
  constructor() {
    super("The badge was sent, but the printed count couldn't be updated.");
    this.name = "MarkPrintedError";
  }
}

export interface PrintAttendeeOptions {
  // Task 9's bulk loop calls `printAttendee` once per selected attendee and
  // invalidates ONCE after the whole loop finishes, instead of once per
  // attendee (cheap dedupe over a page-scoped selection) -- passing `true`
  // here skips THIS call's own invalidation; the bulk dialog is responsible
  // for firing its own single invalidateQueries call after the loop.
  skipInvalidate?: boolean;
}

export interface UsePrintBadgeResult {
  printAttendee(attendee: Attendee, printerName: string, opts?: PrintAttendeeOptions): Promise<void>;
  fontsStatus: ReturnType<typeof useEventFontFaces>["status"];
}

/**
 * The shared print-one-attendee flow (drawer Reprint + Task 9's bulk loop
 * both consume this).
 */
export function usePrintBadge(eventId: string): UsePrintBadgeResult {
  const queryClient = useQueryClient();
  // Keeps the badge-template query warm/shared under the exact same cache
  // key `queryClient.fetchQuery` below reads -- by the time an operator
  // actually confirms a print, this has very likely already resolved (the
  // query starts fetching the moment this hook mounts, well before any
  // click), so the print flow rarely waits on a fresh network round trip.
  useBadgeTemplate(eventId);
  // Always enabled -- every consumer of this hook (the drawer's Reprint
  // button, Task 9's bulk dialog) IS a print surface; there's no "probe
  // first" gating to do here the way TestPrintDialog gates
  // useEventFontFaces(eventId, open) behind its own dialog's open state.
  const fontFaces = useEventFontFaces(eventId, true);

  // Reconciliation #9: generation must never fire before fonts have
  // actually settled (ready OR error) -- printing before that silently
  // rasterizes the browser's fallback glyphs into the printed bitmap (the
  // exact bug this reconciliation exists to prevent). `fontFaces.status` is
  // React state; `printAttendee` is a plain imperative async function (not
  // itself a hook), so it can't just "await" a piece of state -- this ref +
  // waiter-list pair bridges the two without polling: a fresh Promise is
  // queued in `waitersRef` whenever the status isn't yet terminal, and every
  // queued waiter is resolved the moment an effect observes a terminal
  // status.
  const statusRef = React.useRef(fontFaces.status);
  statusRef.current = fontFaces.status;
  const waitersRef = React.useRef<Array<() => void>>([]);

  React.useEffect(() => {
    if (fontFaces.status !== "ready" && fontFaces.status !== "error") return;
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) resolve();
  }, [fontFaces.status]);

  function waitForFontsTerminal(): Promise<void> {
    if (statusRef.current === "ready" || statusRef.current === "error") return Promise.resolve();
    return new Promise((resolve) => {
      waitersRef.current.push(resolve);
    });
  }

  const markPrinted = $api.useMutation("post", "/api/attendees/{attendee_id}/printed");

  async function printAttendee(
    attendee: Attendee,
    printerName: string,
    opts: PrintAttendeeOptions = {},
  ): Promise<void> {
    // Same query key useBadgeTemplate/BADGE_TEMPLATE_KEY use -- `fetchQuery`
    // reuses/awaits an already-in-flight or cached fetch for that exact key
    // rather than firing a redundant request, and reliably resolves to the
    // FRESH value (never the ambiguous "still loading vs. genuinely null"
    // read a bare `.data` snapshot would risk here).
    const templateResponse = await queryClient.fetchQuery(
      $api.queryOptions("get", "/api/events/{id}/badge-template", { params: { path: { id: eventId } } }),
    );
    const raw = templateResponse.template;
    if (!raw) throw new NoTemplateError();

    await waitForFontsTerminal();

    // "Parse-nothing" (reconciliation #13): the raw server doc's elements
    // feed the generator directly -- no parseTemplateDoc defensive
    // narrowing. A template that made it into the database already passed
    // zpl.ParseBadgeTemplate's structural validation at save time.
    //
    // width_mm/height_mm/dpi are the one exception (final-review Important
    // fix): zpl.ParseBadgeTemplate (backend/internal/zpl/zpl.go:334-364)
    // tolerates a raw template whose config keys are missing OR <= 0 by
    // substituting 50mm x 30mm @ 203dpi -- legacy, pre-P3.1 event docs are
    // exactly this shape and flow through this raw read path verbatim. A
    // naive `raw as BadgeConfig` cast leaves those fields `undefined`/`0`,
    // and generateZpl's `mmToDots`/dpi math (`Math.round((mm / 25.4) *
    // dpi)`) silently produces NaN -- `^PWNaN`/`^LLNaN`/`^FONaN,NaN` ZPL that
    // the agent still accepts and sends to the physical printer, reporting
    // "Sent to {{printer}}" and incrementing printed_count even though
    // nothing legible printed. Mirroring the backend's exact fallback here
    // keeps this path's config honest without reintroducing element-level
    // narrowing.
    const rawWidthMM = typeof raw.width_mm === "number" && raw.width_mm > 0 ? raw.width_mm : 50;
    const rawHeightMM = typeof raw.height_mm === "number" && raw.height_mm > 0 ? raw.height_mm : 30;
    const rawDpi = typeof raw.dpi === "number" && raw.dpi > 0 ? raw.dpi : 203;
    const config: BadgeConfig = { width_mm: rawWidthMM, height_mm: rawHeightMM, dpi: rawDpi };
    const elements = Array.isArray(raw.elements) ? (raw.elements as RawBadgeElement[]) : [];
    const data = attendeeToPreviewData(attendee);
    const zpl = await generateZpl(config, elements, data, { rasterizeText });

    await agentClient.print({ printer_name: printerName, zpl });

    // The send has now genuinely happened -- everything from here on is
    // "was it recorded", never "did it print". A mark-printed failure must
    // never retry (or repeat) the send, and must never make this call look
    // like the print itself failed.
    let markPrintedFailed = false;
    try {
      await markPrinted.mutateAsync({ params: { path: { attendee_id: attendee.id } } });
    } catch {
      markPrintedFailed = true;
    }

    if (!opts.skipInvalidate) {
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_DETAIL_KEY(attendee.id) });
    }

    if (markPrintedFailed) throw new MarkPrintedError();
  }

  return { printAttendee, fontsStatus: fontFaces.status };
}
