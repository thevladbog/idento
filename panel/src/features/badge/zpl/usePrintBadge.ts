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
import { resolveBadgeConfig } from "../templateTypes";
import { generateZpl, type RawBadgeElement } from "./generateZpl";
import { collectMissingCustomFonts } from "./missingFonts";
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

/**
 * PR #74 review round Fix 8. Thrown BEFORE generation (no agent call, no
 * printed_count bump) when the template references one or more customFont
 * families the event has no matching uploaded font for -- see
 * `collectMissingCustomFonts` (missingFonts.ts) for why generateZpl's raster
 * branch can't detect this itself (the browser silently substitutes a
 * fallback font and rasterizes THAT, producing a wrong-but-legible bitmap
 * with no error). `families` carries every distinct missing family so
 * callers can name them all in their own surface-specific message.
 */
export class MissingFontError extends Error {
  readonly families: string[];
  constructor(families: string[]) {
    super(`Missing font(s): ${families.join(", ")}`);
    this.name = "MissingFontError";
    this.families = families;
  }
}

export interface PrintAttendeeOptions {
  // Task 9's bulk loop calls `printAttendee` once per selected attendee and
  // invalidates ONCE after the whole loop finishes, instead of once per
  // attendee (cheap dedupe over a page-scoped selection) -- passing `true`
  // here skips THIS call's own invalidation; the bulk dialog is responsible
  // for firing its own single invalidateQueries call after the loop.
  skipInvalidate?: boolean;
  // P4.1 Task 4 extended POST /attendees/{id}/printed with an OPTIONAL
  // {event_id, station_id} body: when event_id is present, the handler logs
  // a checkin_actions ('reprint') row after the counter increment succeeds
  // -- this is how the check-in station's recent-scans rail (Task 9) picks
  // up a reprint. Absent entirely (the default, every P3.1/P3.2 caller
  // unchanged by this task) is the pre-existing back-compat path: counter-
  // only, no feed row. `stationId` is independently nullable (a station-less
  // print context is valid per schema.d.ts's MarkAttendeePrintedRequest) --
  // it's only meaningful server-side when `eventId` is also present.
  printContext?: { eventId: string; stationId: string | null };
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
    // nothing legible printed. `resolveBadgeConfig` (templateTypes.ts)
    // mirrors the backend's exact fallback -- PR #77 bot-review round 2,
    // Finding 4 extracted it out of this call site so the launch ceremony's
    // own "Test badge" action (LaunchCeremony.tsx) can resolve the SAME
    // config for the SAME raw template, rather than validating a different
    // (editor-default) label size/DPI than what actually prints here.
    const config = resolveBadgeConfig(raw);
    const elements = Array.isArray(raw.elements) ? (raw.elements as RawBadgeElement[]) : [];

    // PR #74 review round Fix 8: checked AFTER fonts have reached a terminal
    // status (so `fontFaces.families` reflects the FINAL loaded set, not a
    // still-loading partial one) but BEFORE generation/the agent call --
    // a genuinely wrong badge (a customFont silently substituted with the
    // browser's fallback) must never reach a physical printer.
    const missingFamilies = collectMissingCustomFonts(elements, fontFaces.families);
    if (missingFamilies.length > 0) throw new MissingFontError(missingFamilies);

    const data = attendeeToPreviewData(attendee);
    const zpl = await generateZpl(config, elements, data, { rasterizeText });

    await agentClient.print({ printer_name: printerName, zpl });

    // The send has now genuinely happened -- everything from here on is
    // "was it recorded", never "did it print". A mark-printed failure must
    // never retry (or repeat) the send, and must never make this call look
    // like the print itself failed.
    let markPrintedFailed = false;
    try {
      // No `printContext` -> no `body` key at all (not `body: undefined`),
      // so a caller that never passes it (every P3.1/P3.2 surface, unchanged
      // by this task) sends the exact same request it always did -- the
      // backend's back-compat path (attendee_printed.go) is keyed on the
      // body being genuinely absent, not merely empty-valued.
      if (opts.printContext) {
        await markPrinted.mutateAsync({
          params: { path: { attendee_id: attendee.id } },
          body: { event_id: opts.printContext.eventId, station_id: opts.printContext.stationId },
        });
      } else {
        await markPrinted.mutateAsync({ params: { path: { attendee_id: attendee.id } } });
      }
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
