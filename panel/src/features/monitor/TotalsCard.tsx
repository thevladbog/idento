// P4.2 Task 7 -- the live monitor's "Totals" card (board 7e,
// p4.2-board-7e-extract.md): the big `{checked_in} / {total}` count +
// percent, a green progress bar, then the rate line -- "8.2 scans/min ·
// peak 14.6 at 09:40 · est. done 12:20". `peak`/`est_done_at` are both
// nullable (spec §3.1, backend's monitor_rates.go computeRates) -- their
// segments are simply omitted, never fabricated as a zero/blank
// placeholder. Loading/error states are the PAGE's concern (MonitorPage.tsx
// gates on snapshotQuery before this card ever mounts, same "explicit
// state, never fabricated zeros" discipline StationPage.tsx/
// EventWorkspaceLayout.tsx already establish for their own event queries).
import { Card, CardContent, CardHeader, CardTitle, Progress } from "@idento/ui";
import { useTranslation } from "react-i18next";
import type { components } from "../../shared/api/schema";

type MonitorTotals = components["schemas"]["MonitorTotals"];

export interface TotalsCardProps {
  totals: MonitorTotals;
}

// `hourCycle: "h23"` + `timeZone: "UTC"` deliberately pinned, not left to
// the viewer's locale/timezone defaults: (1) VerdictCard.tsx's own
// formatUtcHHMM documents the codebase-wide convention that a viewer's
// local timezone must never shift a server-recorded check-in-domain
// moment -- `peak.at`/`est_done_at` are exactly that (derived from real
// `checkin_actions.created_at` rows), so the same UTC anchor applies here;
// (2) plain `Intl.DateTimeFormat(locale, {hour:"2-digit",minute:"2-digit"})`
// without an explicit hourCycle renders 12-hour "9:40 AM" for en-US (see
// LiveStrip.tsx's own identical-shaped formatter + LiveStrip.test.tsx's
// "12:00 AM" assertions) -- board 7e's copy is unambiguously 24-hour
// zero-padded ("09:40", "12:20"), which only `hourCycle: "h23"` guarantees
// across locales. `Intl` (rather than a fully hand-rolled formatter) is
// kept so non-Latin numbering systems still localize correctly.
function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function TotalsCard({ totals }: TotalsCardProps) {
  const { t, i18n } = useTranslation();
  const numberFmt = new Intl.NumberFormat(i18n.language);
  const percent = totals.total > 0 ? Math.round((totals.checked_in / totals.total) * 100) : 0;

  const rateParts = [t("monitorRate", { rate: totals.rate_per_min.toFixed(1) })];
  if (totals.peak) {
    rateParts.push(
      t("monitorPeakAt", { rate: totals.peak.rate.toFixed(1), time: formatTime(totals.peak.at, i18n.language) }),
    );
  }
  if (totals.est_done_at) {
    rateParts.push(t("monitorEstDone", { time: formatTime(totals.est_done_at, i18n.language) }));
  }

  return (
    <Card data-testid="monitor-totals-card">
      <CardHeader>
        <CardTitle>{t("monitorTotalsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-extrabold text-foreground">
            {numberFmt.format(totals.checked_in)} / {numberFmt.format(totals.total)}
          </span>
          <span className="text-body font-semibold text-muted-foreground">{percent}%</span>
        </div>
        <Progress value={totals.checked_in} max={totals.total} />
        <p className="text-caption text-muted-foreground">{rateParts.join(" · ")}</p>
      </CardContent>
    </Card>
  );
}
