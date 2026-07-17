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
import { usePrintBadge } from "../badge/zpl/usePrintBadge";
import { useStationCheckin } from "./hooks";
import type { CheckinSettings } from "./settingsTypes";
import { outcomeToVerdict } from "./verdict";

type Attendee = components["schemas"]["Attendee"];
type CheckinInfo = components["schemas"]["CheckinInfo"];
type AttendeeListPage = components["schemas"]["AttendeeListPage"];

export interface UseCheckinFlowOptions {
  eventId: string;
  // The registered station this scan is happening at -- forwarded as
  // `station_id` on the check-in call AND (on a checked_in print) as the
  // print pipeline's `printContext.stationId`. `null` is a valid,
  // deliberately-supported "station-less" check-in (schema.d.ts's
  // StationCheckinRequest comment).
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
    // Zero-double-print at the source (plan global constraint): printing
    // fires ONLY on the server's own "checked_in" outcome -- never
    // "already_checked_in"/"blocked", regardless of settings.
    if (response.outcome === "checked_in" && settings.print_on_checkin) {
      try {
        await printBadge.printAttendee(response.attendee, printerName, {
          printContext: { eventId, stationId },
        });
      } catch (error) {
        // The check-in already committed server-side -- a print failure
        // here must never look like (or cause) an undone check-in. The
        // person is in; this is surfaced separately, not as a verdict
        // change.
        printError = error;
      }
    }

    setState({
      status: "verdict",
      verdict: outcomeToVerdict(response.outcome),
      attendee: response.attendee,
      checkin: response.checkin,
      printError,
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
      // "resolving" forever; reset to idle and let the caller decide how to
      // surface it (Task 10's degraded mode owns the offline story).
      setState(IDLE_STATE);
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
      setState(IDLE_STATE);
      throw error;
    } finally {
      busyRef.current = false;
    }
  }

  return { state, submitCode, submitAttendee, clear };
}
