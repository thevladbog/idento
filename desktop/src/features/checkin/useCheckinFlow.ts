// The check-in station's core state machine. Resolves a scanned code
// (submitCode) or a manually-picked attendee (submitAttendee) to one of the
// four station outcomes (verdict.ts's outcomeToVerdict), fires the
// idempotent check-in mutation, and -- ONLY on the server's own "checked_in"
// outcome, and ONLY when settings.print_on_checkin -- auto-prints via the
// agent. printCurrent is the separate, always-available manual "Печать"
// path (VerdictScreen renders it only when the auto-print didn't already
// fire) -- unlike the auto path, it always passes event_id/station_id to
// markAttendeePrinted, logging a genuine `reprint` audit row.
import { useEffect, useRef, useState } from "react";
import type { Verdict } from "@idento/ui";
import { agentPost } from "../../lib/agent";
import { api } from "../../lib/api";
import { useMarkAttendeePrinted, useStationCheckin } from "./hooks";
import type { CheckinSettings } from "./settingsTypes";
import type { Attendee, CheckinInfo } from "./types";
import { outcomeToVerdict } from "./verdict";

export interface UseCheckinFlowOptions {
  eventId: string;
  stationId: string | null;
  settings: CheckinSettings;
  printerName: string;
}

export interface CheckinFlowState {
  status: "idle" | "resolving" | "verdict";
  verdict?: Verdict;
  attendee?: Attendee;
  checkin?: CheckinInfo | null;
  printError?: unknown;
  printPending?: boolean;
  requestError?: unknown;
}

export interface UseCheckinFlowResult {
  state: CheckinFlowState;
  submitCode(code: string): Promise<void>;
  submitAttendee(attendee: Attendee): Promise<void>;
  printCurrent(): Promise<void>;
  clear(): void;
}

const IDLE_STATE: CheckinFlowState = { status: "idle" };

async function printAttendeeBadge(eventId: string, attendee: Attendee, printerName: string): Promise<void> {
  const { data } = await api.post<{ zpl: string }>(`/api/events/${eventId}/badge-zpl`, { attendee_id: attendee.id });
  await agentPost("/print", JSON.stringify({ printer_name: printerName, zpl: data.zpl }));
}

export function useCheckinFlow({ eventId, stationId, settings, printerName }: UseCheckinFlowOptions): UseCheckinFlowResult {
  const [state, setState] = useState<CheckinFlowState>(IDLE_STATE);
  const stationCheckin = useStationCheckin(eventId);
  const markPrinted = useMarkAttendeePrinted();

  const dismissTimerRef = useRef<number | undefined>(undefined);
  const busyRef = useRef(false);
  const printBusyRef = useRef(false);

  const clearDismissTimer = () => {
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = undefined;
  };

  useEffect(() => clearDismissTimer, []);

  const scheduleAutoDismiss = (verdict: Verdict) => {
    clearDismissTimer();
    // "already_checked_in" never auto-dismisses -- the operator decides.
    if (verdict === "already_checked_in") return;
    dismissTimerRef.current = window.setTimeout(() => {
      setState(IDLE_STATE);
    }, settings.verdict_auto_dismiss_sec * 1000);
  };

  const clear = () => {
    clearDismissTimer();
    setState(IDLE_STATE);
  };

  useEffect(() => {
    busyRef.current = false;
    printBusyRef.current = false;
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, stationId]);

  async function resolveCheckin(attendee: Attendee): Promise<void> {
    const response = await stationCheckin.mutateAsync({ attendee_id: attendee.id, station_id: stationId });

    let printError: unknown;
    if (response.outcome === "checked_in" && settings.print_on_checkin) {
      try {
        await printAttendeeBadge(eventId, response.attendee, printerName);
        // Deliberately no event_id/station_id: the check-in itself already
        // logged the `checkin` feed row. Passing them would double-log a
        // `reprint` row for the same check-in.
        await markPrinted.mutateAsync({ attendeeId: response.attendee.id });
      } catch (error) {
        printError = error;
      }
    }

    const verdict = outcomeToVerdict(response.outcome);
    setState({ status: "verdict", verdict, attendee: response.attendee, checkin: response.checkin, printError });
    scheduleAutoDismiss(verdict);
  }

  async function submitCode(code: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    clearDismissTimer();
    setState({ status: "resolving" });
    try {
      const { data } = await api.get<Attendee[]>(`/api/events/${eventId}/attendees`, { params: { code } });
      const attendee = Array.isArray(data) ? data[0] : undefined;

      if (!attendee) {
        const verdict = outcomeToVerdict("not_found");
        setState({ status: "verdict", verdict });
        scheduleAutoDismiss(verdict);
        return;
      }

      await resolveCheckin(attendee);
    } catch (error) {
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

  async function printCurrent(): Promise<void> {
    if (state.status !== "verdict" || state.verdict !== "allowed" || !state.attendee) return;
    if (printBusyRef.current) return;
    printBusyRef.current = true;
    const currentAttendee = state.attendee;
    setState((prev) => (prev.status === "verdict" ? { ...prev, printPending: true } : prev));
    try {
      await printAttendeeBadge(eventId, currentAttendee, printerName);
      await markPrinted.mutateAsync({ attendeeId: currentAttendee.id, eventId, stationId });
      setState((prev) => (prev.status === "verdict" ? { ...prev, printError: undefined, printPending: false } : prev));
    } catch (error) {
      setState((prev) => (prev.status === "verdict" ? { ...prev, printError: error, printPending: false } : prev));
    } finally {
      printBusyRef.current = false;
    }
  }

  return { state, submitCode, submitAttendee, printCurrent, clear };
}
