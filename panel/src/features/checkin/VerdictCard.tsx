// P4.1 Task 8 -- the check-in station's main verdict panel. Pure,
// props-driven (like WorkspaceRail.tsx): renders whatever
// useCheckinFlow.state currently is, through @idento/ui's shared
// `verdictClasses` (plan global constraint -- "Verdict rendering reuses
// @idento/ui verdictClasses ... Never invent verdict colors"). Every
// verdict pairs its color with a real icon AND a real text label (WCAG
// 1.4.1 -- color alone never carries the meaning), same idiom
// WorkspaceRail's STEP_STATUS_ICON already establishes for readiness
// steps.
import { CheckCircle2, HelpCircle, Loader2, RotateCcw, ScanLine, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { verdictClasses, type Verdict } from "@idento/ui";
import type { CheckinFlowState } from "./useCheckinFlow";

export interface VerdictCardProps {
  state: CheckinFlowState;
}

const VERDICT_ICON: Record<Verdict, typeof CheckCircle2> = {
  allowed: CheckCircle2,
  no_access: XCircle,
  not_registered: HelpCircle,
  already_checked_in: RotateCcw,
};

const VERDICT_LABEL_KEY: Record<Verdict, string> = {
  allowed: "checkinVerdictAllowed",
  no_access: "checkinVerdictNoAccess",
  not_registered: "checkinVerdictNotRegistered",
  already_checked_in: "checkinVerdictAlreadyCheckedIn",
};

// Hand-rolled UTC HH:MM formatter -- same convention as
// AttendeeDrawer.tsx's own (private, not exported) formatUtcHHMM: a
// viewer's local timezone must not shift a server-recorded check-in
// moment, so every check-in timestamp in this app renders in UTC. Small
// enough (4 lines) that duplicating it here beats a cross-feature import
// into attendees/ for one helper.
function formatUtcHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function VerdictCard({ state }: VerdictCardProps) {
  const { t } = useTranslation();

  if (state.status === "idle") {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center"
        data-testid="checkin-verdict-idle"
      >
        <ScanLine aria-hidden className="size-10 text-muted-foreground" />
        <p className="text-body text-muted-foreground">{t("checkinIdleHint")}</p>
      </div>
    );
  }

  if (state.status === "resolving" || !state.verdict) {
    // The `!state.verdict` fallback is defensive only -- useCheckinFlow
    // never sets status "verdict" without one -- but keeps this component
    // from asserting a shape its own prop type only optionally guarantees.
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border p-12 text-center"
        data-testid="checkin-verdict-resolving"
      >
        <Loader2 aria-hidden className="size-10 animate-spin text-muted-foreground" />
        <p className="text-body text-muted-foreground">{t("checkinResolvingHint")}</p>
      </div>
    );
  }

  const verdict = state.verdict;
  const classes = verdictClasses[verdict];
  const Icon = VERDICT_ICON[verdict];
  const attendee = state.attendee;

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-4 rounded-lg p-12 text-center ${classes.bg}`}
      data-testid="checkin-verdict-card"
      data-verdict={verdict}
    >
      <Icon aria-hidden className={`size-16 ${classes.text}`} />
      <p className={`text-page-title ${classes.text}`}>{t(VERDICT_LABEL_KEY[verdict])}</p>

      {attendee ? (
        <p className="text-section-title text-foreground">
          {attendee.first_name} {attendee.last_name}
          <span className="ml-2 font-mono text-body text-muted-foreground">{attendee.code}</span>
        </p>
      ) : null}

      {verdict === "already_checked_in" && state.checkin ? (
        <p className="text-body text-muted-foreground" data-testid="checkin-first-scan-meta">
          {t("checkinFirstScanAt", { time: formatUtcHHMM(state.checkin.at) })}
          {state.checkin.point_name ? ` · ${state.checkin.point_name}` : ""}
        </p>
      ) : null}

      {state.printError ? (
        <p className="text-caption text-warning" role="status">
          {t("checkinPrintFailedWarning")}
        </p>
      ) : null}
    </div>
  );
}
