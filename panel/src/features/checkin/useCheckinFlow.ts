// P4.1 Task 6 -- the check-in station's core state machine. Resolves a
// scanned code (submitCode) or a manually-picked attendee (submitAttendee,
// Task 7's manual search) to one of the four station outcomes
// (verdict.ts's outcomeToVerdict), fires the idempotent check-in mutation
// (Task 5's useStationCheckin, which already invalidates
// CHECKIN_ACTIONS_KEY/ATTENDEES_LIST_KEY unconditionally on every call --
// see hooks.ts's own comments), and -- ONLY on the server's own
// "checked_in" outcome, and ONLY when the event's settings say so -- fires
// the shared P3.2 print pipeline (usePrintBadge). This is the ONE place
// printing is wired into the check-in loop (plan global constraint: "Print
// fires ONLY on the checked_in outcome -- zero double-print at the
// source"); Task 7 (scan input) and Task 8 (station route) both consume
// this hook rather than re-deriving any of it.
import * as React from "react";
import type { Verdict } from "@idento/ui";
import { api } from "../../shared/api/http";
import type { components } from "../../shared/api/schema";
import { MarkPrintedError, usePrintBadge } from "../badge/zpl/usePrintBadge";
import { useStationCheckin } from "./hooks";
import type { CheckinSettings } from "./settingsTypes";
import { outcomeToVerdict } from "./verdict";

type Attendee = components["schemas"]["Attendee"];
type CheckinInfo = components["schemas"]["CheckinInfo"];
type AttendeeListPage = components["schemas"]["AttendeeListPage"];

export interface UseCheckinFlowOptions {
  eventId: string;
  // The registered station this scan is happening at -- forwarded as
  // `station_id` on the check-in call. `null` is a valid,
  // deliberately-supported "station-less" check-in (schema.d.ts's
  // StationCheckinRequest comment). NOT forwarded to the implicit
  // checked_in auto-print's printAttendee call (see resolveCheckin below --
  // that call deliberately omits `printContext` entirely, since the
  // check-in itself was already logged by stationCheckin.mutateAsync).
  stationId: string | null;
  settings: CheckinSettings;
  // The printer to send a checked_in badge to. Task 8/9's callers own
  // resolving this (agent default / reachability-gated selection) -- this
  // hook just forwards it to usePrintBadge.printAttendee verbatim.
  printerName: string;
}

export interface CheckinFlowState {
  status: "idle" | "resolving" | "verdict";
  verdict?: Verdict;
  attendee?: Attendee;
  // The first-scan metadata block -- present for checked_in/already_checked_in,
  // `null` for blocked (schema.d.ts's StationCheckinResponse comment),
  // `undefined` for the client-side not_found outcome (there was never a
  // server round trip to carry it).
  checkin?: CheckinInfo | null;
  // The raw error caught from a best-effort print attempt, if one was made
  // and it failed. Deliberately `unknown` -- exactly like every OTHER
  // usePrintBadge caller in this codebase (AttendeeDrawer.tsx's
  // reprintError, BulkBar.tsx): this hook never calls useTranslation()/t()
  // itself (that's the render layer's job, per this codebase's own
  // convention -- hooks return typed/raw data, components translate it), so
  // it doesn't pre-classify the error into copy it has no business owning.
  // A print failure NEVER reverts status/verdict/attendee/checkin -- the
  // check-in already committed server-side; this field is purely additive
  // surfacing for whatever UI (Task 8's VerdictCard) wants to show it.
  printError?: unknown;
  // PR #77 bot-review round, Finding I -- set instead of (never alongside)
  // `printError` when the print step's failure was specifically a
  // MarkPrintedError: the badge WAS sent (usePrintBadge.printAttendee's own
  // doc comment -- "Non-fatal from the operator's perspective") and only the
  // `/printed` counter-update afterward failed. Carries the printer name so
  // the UI can reuse RecentScansRail.tsx's own MarkPrintedError copy
  // verbatim (that copy is printer-name-parameterized) rather than a
  // parallel printer-less message.
  printMarkFailed?: { printer: string };
  // PR #77 bot-review round 2, Finding 2 -- set (instead of even ATTEMPTING
  // the print, so never alongside printError/printMarkFailed) when a
  // checked_in scan resolves while `printBadge.fontsStatus` hasn't reached a
  // terminal state (`ready`/`error`) yet. usePrintBadge.printAttendee
  // internally awaits font readiness before generating, but it does so
  // through a closure captured AT CALL TIME -- calling it while fonts are
  // still loading risks that closure's own `fontFaces.families` being the
  // STALE (pre-load) snapshot from the render printAttendee was created in,
  // even after the internal wait resolves, which can produce a spurious
  // MissingFontError for a purely timing reason. Checking `fontsStatus` here
  // BEFORE ever calling printAttendee (mirroring how every OTHER print
  // surface -- TestPrintDialog, the drawer's reprint confirm, RecentScansRail
  // -- gates its own print action on this exact terminal-state check) avoids
  // the call entirely rather than trusting the internal wait. This is a
  // third, distinct case from printError/printMarkFailed -- no print was
  // attempted at all, so telling the operator "reprint it" (printError's
  // copy) would be accurate advice but wrongly implies a genuine failure.
  printFontsPending?: boolean;
  // PR #77 bot-review round, Finding F -- set when submitCode/submitAttendee
  // ITSELF fails (network error, 5xx on the check-in POST, or the code
  // lookup GET) -- NOT a print failure, which never reverts status. `status`
  // is reset to "idle" in the SAME setState call that sets this, so the
  // operator can immediately scan/search again; this field lets the idle
  // view explain why the previous attempt produced no verdict instead of
  // silently going quiet. This hook still re-throws the error afterward
  // (unchanged -- callers may want it too), so every caller must still
  // `.catch()` the call (see StationPage.tsx's handleCode/handlePickAttendee)
  // to avoid an unhandled promise rejection; this field is what actually
  // gives the operator something visible, independent of whether a given
  // caller bothers to inspect the rejected error itself.
  requestError?: unknown;
}

export interface UseCheckinFlowResult {
  state: CheckinFlowState;
  submitCode(code: string): Promise<void>;
  submitAttendee(attendee: Attendee): Promise<void>;
  clear(): void;
}

const IDLE_STATE: CheckinFlowState = { status: "idle" };

export function useCheckinFlow({ eventId, stationId, settings, printerName }: UseCheckinFlowOptions): UseCheckinFlowResult {
  const [state, setState] = React.useState<CheckinFlowState>(IDLE_STATE);
  const stationCheckin = useStationCheckin(eventId);
  const printBadge = usePrintBadge(eventId);

  const dismissTimerRef = React.useRef<number | undefined>(undefined);
  // Best-effort re-entrancy guard: a scan/manual-pick that arrives while a
  // PREVIOUS one is still resolving (network round trip + a possible print)
  // is dropped rather than fired concurrently -- there is no legitimate
  // reason for two check-ins to be in flight for the same station at once,
  // and letting a second one race the first risks two check-in POSTs for
  // what a fast double-scan meant as one. A ref (not state) because it must
  // be read/written synchronously at call time, not on the next render.
  const busyRef = React.useRef(false);

  const clearDismissTimer = React.useCallback(() => {
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = undefined;
  }, []);

  // Unmount safety: a pending auto-dismiss must never fire setState after
  // this hook's owner (the station route) has gone away.
  React.useEffect(() => clearDismissTimer, [clearDismissTimer]);

  const scheduleAutoDismiss = React.useCallback(() => {
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      setState(IDLE_STATE);
    }, settings.verdict_auto_dismiss_sec * 1000);
  }, [clearDismissTimer, settings.verdict_auto_dismiss_sec]);

  const clear = React.useCallback(() => {
    clearDismissTimer();
    setState(IDLE_STATE);
  }, [clearDismissTimer]);

  async function resolveCheckin(attendee: Attendee): Promise<void> {
    const response = await stationCheckin.mutateAsync({
      params: { path: { event_id: eventId } },
      body: { attendee_id: attendee.id, station_id: stationId },
    });

    let printError: unknown;
    let printMarkFailed: { printer: string } | undefined;
    let printFontsPending = false;
    // Zero-double-print at the source (plan global constraint): printing
    // fires ONLY on the server's own "checked_in" outcome -- never
    // "already_checked_in"/"blocked", regardless of settings.
    if (response.outcome === "checked_in" && settings.print_on_checkin) {
      // PR #77 bot-review round 2, Finding 2 -- read fresh HERE, at call
      // time, not before: `printBadge.fontsStatus` reflects THIS render of
      // useCheckinFlow, so gating on it before ever calling printAttendee
      // means printAttendee (when it IS called) always closes over an
      // already-terminal `fontFaces`/`families` snapshot -- see the
      // `printFontsPending` field's own doc comment above for why that
      // matters (a call made while fonts are still loading can race its own
      // internal wait). "idle" counts as pending too (fonts haven't even
      // started loading) -- only "ready"/"error" are terminal.
      const fontsReady = printBadge.fontsStatus === "ready" || printBadge.fontsStatus === "error";
      if (!fontsReady) {
        printFontsPending = true;
      } else {
        try {
          // Deliberately NO `printContext` here. This is the IMPLICIT
          // auto-print that fulfills the check-in that just happened --
          // `stationCheckin.mutateAsync` above already logged a `checkin` row
          // in the same DB transaction as the state change (Task 3's
          // CheckInAttendee). Passing `printContext` would make the backend's
          // /printed endpoint (Task 4) log an ADDITIONAL `reprint` row for
          // this same event, double-logging the feed for a single check-in
          // (final cross-task review finding). Falling back to no
          // `printContext` keeps this call on the pre-existing P3.2
          // counter-only behavior: bumps `printed_count`, no feed row. The
          // Recent-Scans-Rail's OWN Reprint button (RecentScansRail.tsx) is
          // the genuine, distinct, operator-initiated reprint action and
          // correctly keeps passing `printContext` there.
          await printBadge.printAttendee(response.attendee, printerName);
        } catch (error) {
          // The check-in already committed server-side -- a print failure
          // here must never look like (or cause) an undone check-in. The
          // person is in; this is surfaced separately, not as a verdict
          // change.
          //
          // PR #77 bot-review round, Finding I -- a MarkPrintedError means the
          // agent print itself SUCCEEDED and only the later /printed
          // counter-update call failed -- collapsing it into the same
          // `printError` VerdictCard renders as "reprint it" would invite an
          // unnecessary duplicate print for a badge that may already be
          // printing/printed. Kept mutually exclusive from `printError` (only
          // one of the two is ever set).
          if (error instanceof MarkPrintedError) {
            printMarkFailed = { printer: printerName };
          } else {
            printError = error;
          }
        }
      }
    }

    setState({
      status: "verdict",
      verdict: outcomeToVerdict(response.outcome),
      attendee: response.attendee,
      checkin: response.checkin,
      printError,
      printMarkFailed,
      printFontsPending,
    });
    scheduleAutoDismiss();
  }

  async function submitCode(code: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    clearDismissTimer();
    setState({ status: "resolving" });
    try {
      // The existing scalable server exact-match (plan-time fact #2) --
      // deliberately NOT the whole roster. No `page`/`per_page` means the
      // response is the legacy bare-array shape (getAttendees' own oneOf).
      const { data } = await api.GET("/api/events/{event_id}/attendees", {
        params: { path: { event_id: eventId }, query: { code } },
      });
      const matches: Attendee[] = Array.isArray(data) ? data : ((data as AttendeeListPage | undefined)?.attendees ?? []);
      const attendee = matches[0];

      if (!attendee) {
        // Client-side outcome: the lookup itself came back empty, so there
        // is no attendee to check in -- this never reaches
        // useStationCheckin at all.
        setState({ status: "verdict", verdict: outcomeToVerdict("not_found") });
        scheduleAutoDismiss();
        return;
      }

      await resolveCheckin(attendee);
    } catch (error) {
      // A genuine failure resolving the check-in itself (network error,
      // 5xx, etc. -- not a print failure, which resolveCheckin already
      // swallows into printError) must not leave the flow stuck on
      // "resolving" forever; reset to idle so the operator can immediately
      // retry (Task 10's degraded mode owns the offline story), and record
      // it as `requestError` (PR #77 Finding F) so the idle view can show
      // SOMETHING rather than silently dropping the scan -- still re-thrown
      // so a caller that wants the raw error can also see it, but every
      // caller must `.catch()` this (StationPage.tsx's handleCode/
      // handlePickAttendee do) to avoid an unhandled rejection.
      setState({ status: "idle", requestError: error });
      throw error;
    } finally {
      busyRef.current = false;
    }
  }

  async function submitAttendee(attendee: Attendee): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    clearDismissTimer();
    setState({ status: "resolving" });
    try {
      await resolveCheckin(attendee);
    } catch (error) {
      setState({ status: "idle", requestError: error });
      throw error;
    } finally {
      busyRef.current = false;
    }
  }

  return { state, submitCode, submitAttendee, clear };
}
