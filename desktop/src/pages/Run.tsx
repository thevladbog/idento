import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  TopStatusBar,
  OperatorPanel,
  VerdictScreen,
  BlockingBanner,
  RecentLog,
  KioskInput,
  BarcodeBeam,
  stationLevel,
  type KioskNode,
} from "@idento/ui/kiosk";
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinActions,
  useCheckinSettings,
  useEvent,
} from "@/features/checkin/hooks";
import { useCheckinFlow } from "@/features/checkin/useCheckinFlow";
import { useConnectionState } from "@/features/checkin/useConnectionState";
import { useHeartbeat } from "@/features/checkin/useHeartbeat";
import { useScanInput } from "@/features/checkin/useScanInput";
import { DEFAULT_CHECKIN_SETTINGS } from "@/features/checkin/settingsTypes";
import { loadRunLayout } from "@/pages/Mode";

export default function RunPage() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const stationId = localStorage.getItem("idento_station_id");
  const layout = loadRunLayout();

  useHeartbeat(eventId!, stationId);
  const connection = useConnectionState(eventId!);
  const eventQuery = useEvent(eventId!);
  const settingsQuery = useCheckinSettings(eventId!);
  const settings = settingsQuery.data ?? DEFAULT_CHECKIN_SETTINGS;
  const printer = useAgentDefaultPrinter();
  const agentHealth = useAgentHealth();
  const actionsQuery = useCheckinActions(eventId!);

  const printerGateActive = settings.print_on_checkin && !printer.data;

  const flow = useCheckinFlow({
    eventId: eventId!,
    stationId,
    settings,
    printerName: printer.data ?? "",
  });

  const [searchValue, setSearchValue] = useState("");
  const scanEnabled = flow.state.status === "idle" && connection.online && !printerGateActive;

  const { wedgeInputProps, degraded: scannerDegraded } = useScanInput({
    mode: settings.scan_input,
    onCode: (code) => void flow.submitCode(code).catch(() => {}),
    enabled: scanEnabled,
  });

  const nodes: KioskNode[] = useMemo(
    () => [
      { id: "server", label: t("runNodeServer"), level: connection.online ? "ok" : "error" },
      { id: "agent", label: t("runNodeAgent"), level: agentHealth.data ? "ok" : "error" },
      {
        id: "printer",
        label: t("runNodePrinter"),
        level: !settings.print_on_checkin ? "ok" : printer.data ? "ok" : "warn",
        detail: printer.data ?? undefined,
      },
      {
        id: "scanner",
        label: t("runNodeScanner"),
        level: settings.scan_input === "scanner" && scannerDegraded ? "error" : "ok",
        live: settings.scan_input === "scanner",
      },
    ],
    [t, connection.online, agentHealth.data, settings.print_on_checkin, settings.scan_input, printer.data, scannerDegraded],
  );

  const level = stationLevel(nodes);

  const log = (actionsQuery.data ?? [])
    .filter((row) => row.action === "checkin")
    .slice(0, 3)
    .map((row) => ({
      time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      name: `${row.attendee.first_name} ${row.attendee.last_name}`,
      outcome: "allowed" as const,
    }));

  const verdictProps = (() => {
    if (flow.state.status !== "verdict" || !flow.state.verdict) return null;
    const v = flow.state.verdict;
    const name = flow.state.attendee ? `${flow.state.attendee.first_name} ${flow.state.attendee.last_name}` : undefined;
    if (v === "allowed") {
      return {
        verdict: v,
        title: t("runAllowedTitle"),
        name,
        actions: settings.print_on_checkin
          ? undefined
          : [{ label: t("print"), kind: "solid" as const, onClick: () => void flow.printCurrent() }],
        autoReturn: { label: t("checking"), progress: 0.5 },
      };
    }
    if (v === "already_checked_in") {
      return {
        verdict: v,
        title: t("runAlreadyTitle"),
        name,
        highlight: flow.state.checkin ? `${flow.state.checkin.at} · ${flow.state.checkin.by_email}` : undefined,
        actions: [{ label: t("done"), kind: "outline" as const, onClick: () => flow.clear() }],
      };
    }
    if (v === "no_access") {
      return {
        verdict: v,
        title: t("runBlockedTitle"),
        name,
        meta: flow.state.attendee?.block_reason ? [{ label: t("runBlockReason"), value: flow.state.attendee.block_reason }] : undefined,
        actions: [{ label: t("done"), kind: "outline" as const, onClick: () => flow.clear() }],
      };
    }
    return {
      verdict: v,
      title: t("runNotFoundTitle"),
      message: t("runNotFoundMessage"),
      actions: [{ label: t("done"), kind: "outline" as const, onClick: () => flow.clear() }],
    };
  })();

  const eventName = eventQuery.data?.name ?? "";

  const chrome =
    layout === "panel" ? (
      <OperatorPanel eventName={eventName} nodes={nodes} counterValue={log.length} counterLabel={t("runCounted")} log={log} />
    ) : (
      <TopStatusBar eventName={eventName} nodes={nodes} counterLabel={t("runCounted")} counterValue={log.length} />
    );

  return (
    <div className="flex h-screen flex-col bg-kiosk-bg" style={{ fontFamily: "var(--kiosk-font)" }}>
      {layout === "bar" && chrome}
      {level === "blocked" && !connection.online && (
        <BlockingBanner title={t("runNoServer")} subtitle={t("runNoServerDesc")} retryLabel={t("runRetryNow")} onRetry={() => void actionsQuery.refetch()} />
      )}
      <div className="flex flex-1 overflow-hidden">
        {layout === "panel" && chrome}
        <div className="flex flex-1 flex-col items-center justify-center gap-10 p-10">
          {verdictProps ? (
            <VerdictScreen {...verdictProps} className="h-full w-full" />
          ) : printerGateActive ? (
            <p className="text-kiosk-text-3">{t("runPrinterWaiting")}</p>
          ) : (
            <>
              {settings.scan_input !== "manual" && <BarcodeBeam dimmed={!scanEnabled} />}
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="kiosk-type-idle-title text-kiosk-text">{t("runReadyToScan")}</div>
                <p className="text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>{t("runScanHint")}</p>
              </div>
              <input aria-hidden {...wedgeInputProps} className="sr-only" />
              {settings.manual_search_enabled && (
                <KioskInput
                  className="w-[480px]"
                  placeholder={t("runManualSearchPlaceholder")}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  disabled={!scanEnabled}
                />
              )}
            </>
          )}
        </div>
      </div>
      {layout === "bar" && log.length > 0 && <RecentLog entries={log} />}
    </div>
  );
}
