// Self-service run screen (K2b). Reuses K2a's useCheckinFlow directly and
// unmodified -- the same re-entrancy guard, print-on-checkin, and dismiss
// timer staffed Run.tsx relies on. The one behavioral gap -- useCheckinFlow
// deliberately never auto-dismisses "already_checked_in" (an operator
// decides, in staffed mode) -- is bridged below with a local effect, not a
// change to the shared hook: self-service has no operator, so every
// verdict must eventually return to the attract screen on its own.
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { VerdictScreen, BlockingBanner } from "@idento/ui/kiosk";
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinActions,
  useCheckinSettings,
} from "@/features/checkin/hooks";
import { useCheckinFlow } from "@/features/checkin/useCheckinFlow";
import { useConnectionState } from "@/features/checkin/useConnectionState";
import { useHeartbeat } from "@/features/checkin/useHeartbeat";
import { useScanInput } from "@/features/checkin/useScanInput";
import { DEFAULT_CHECKIN_SETTINGS } from "@/features/checkin/settingsTypes";
import { AttractScreen } from "@/components/AttractScreen";

export default function SelfServicePage() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const stationId = localStorage.getItem(`idento_station_id:${eventId}`);

  useHeartbeat(eventId!, stationId);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (active) await invoke("enter_lockdown");
      } catch {
        // Not running under Tauri (e.g. plain browser dev) -- no window to
        // lock down; the rest of the page still functions for local dev.
      }
    })();
    return () => {
      active = false;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("exit_lockdown");
        } catch {
          // Same non-Tauri dev fallback as above.
        }
      })();
    };
  }, []);

  const connection = useConnectionState(eventId!);
  // Held only for its .refetch() -- shares the "checkin-actions" cache key
  // with useConnectionState's internal query (same eventId, same default
  // limit), so refetching here is what actually clears the banner below.
  // Self-service shows no operator-facing log, so .data is never rendered.
  const actionsQuery = useCheckinActions(eventId!);
  const settingsQuery = useCheckinSettings(eventId!);
  const settings = settingsQuery.data ?? DEFAULT_CHECKIN_SETTINGS;
  const printer = useAgentDefaultPrinter();
  const agentHealth = useAgentHealth();

  const printerGateActive = settings.print_on_checkin && !printer.data;

  const flow = useCheckinFlow({
    eventId: eventId!,
    stationId,
    settings,
    printerName: printer.data ?? "",
  });

  useEffect(() => {
    if (flow.state.status !== "verdict" || flow.state.verdict !== "already_checked_in") return;
    const timer = window.setTimeout(() => flow.clear(), settings.verdict_auto_dismiss_sec * 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.state.status, flow.state.verdict, settings.verdict_auto_dismiss_sec]);

  const scanEnabled = flow.state.status === "idle" && connection.online && !printerGateActive;

  // checkin-settings is event-wide (shared with any staffed station on the
  // same event) -- a "manual" value could be inherited mid-session from a
  // different station. Self-service renders no manual-search UI at all, so
  // treat that case as "wedge" rather than silently capturing nothing.
  const { wedgeInputProps } = useScanInput({
    mode: settings.scan_input === "manual" ? "wedge" : settings.scan_input,
    onCode: (code) => void flow.submitCode(code).catch(() => {}),
    enabled: scanEnabled,
  });

  const verdictProps = (() => {
    if (flow.state.status !== "verdict" || !flow.state.verdict) return null;
    const v = flow.state.verdict;
    const name = flow.state.attendee ? `${flow.state.attendee.first_name} ${flow.state.attendee.last_name}` : undefined;
    // title is required by VerdictScreenProps even though privacy mode
    // never renders it -- reusing Run.tsx's existing run*Title keys avoids
    // new i18n entries for a value that's never actually shown.
    if (v === "allowed") return { verdict: v, title: t("runAllowedTitle"), name, message: t("selfAllowedMessage") };
    if (v === "already_checked_in") return { verdict: v, title: t("runAlreadyTitle"), name, message: t("selfAlreadyMessage") };
    if (v === "no_access") return { verdict: v, title: t("runBlockedTitle"), name, message: t("selfBlockedMessage") };
    return { verdict: v, title: t("runNotFoundTitle"), message: t("selfNotFoundMessage") };
  })();

  return (
    <div className="relative flex h-screen flex-col bg-kiosk-bg" style={{ fontFamily: "var(--kiosk-font)" }}>
      {!connection.online && (
        <BlockingBanner
          title={t("runNoServer")}
          subtitle={t("runNoServerDesc")}
          retryLabel={t("runRetryNow")}
          onRetry={() => void actionsQuery.refetch()}
        />
      )}
      {connection.online && !agentHealth.data && (
        <BlockingBanner title={t("selfAgentUnavailable")} retryLabel={t("runRetryNow")} onRetry={() => void agentHealth.refetch()} />
      )}
      <div className="flex flex-1 items-center justify-center">
        {verdictProps ? (
          <VerdictScreen {...verdictProps} privacy className="h-full w-full" />
        ) : printerGateActive ? (
          <p className="text-kiosk-text-3">{t("runPrinterWaiting")}</p>
        ) : (
          <AttractScreen />
        )}
      </div>
      <input aria-hidden {...wedgeInputProps} className="sr-only" />
    </div>
  );
}
