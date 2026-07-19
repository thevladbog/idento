// P4.2 Task 8 -- the live monitor's "Last scans" card (board 7e,
// p4.2-board-7e-extract.md): compact, READ-ONLY rows -- bare stroke icon
// (no circle badge) + name/zone + mono timestamp. Unlike P4.1's station
// rail (RecentScansRail.tsx), there are NO action buttons here at all --
// the olabel is explicit ("glanceable from across the room, read-only, no
// prep chrome").
//
// `recent[]` reuses CheckinActionRow (the same shape as the check-in
// station's own feed) -- `action` is one of "checkin" | "undo" | "reprint".
// Only "checkin" rows are a verdict (and always the SAME verdict:
// checkin_actions only ever logs a 'checkin' row on outcome "checked_in",
// never on "already_checked_in"/"blocked" -- see backend
// pg_store_checkin_test.go's own comment, "never already_checked_in, never
// an [other outcome]"), so `verdictClasses.allowed` is the ONLY verdict
// token this card ever reaches for. `undo`/`reprint` are NOT verdicts --
// they're neutral, muted icons per the plan's Global Constraints
// (`RotateCcw`/`Printer`, `text-muted-foreground`), never colored via
// `verdictClasses`.
//
// Zone name is derived, not stored on the row: `station_id` -> the
// snapshot's own `stations[]` -> that station's `zone_id` -> the
// snapshot's own `zones[]`. Omitted (not a placeholder dash) whenever any
// link in that chain is missing (station-less row, station with no zone,
// or -- defensively -- a zone_id that doesn't match a current zone).
import { CheckCircle2, Printer, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, verdictClasses } from "@idento/ui";
import { useTranslation } from "react-i18next";
import type { components } from "../../shared/api/schema";

type CheckinActionRow = components["schemas"]["CheckinActionRow"];
type MonitorStationRow = components["schemas"]["MonitorStationRow"];
type MonitorZone = components["schemas"]["MonitorZone"];

// PR #81 round-2 convergence Finding 4: undo/reprint rows used to be
// distinguishable from a checkin row ONLY by an `aria-hidden` icon -- a
// screen reader heard just name/zone/time, indistinguishable from a
// check-in. Mirrors WorkspaceRail.tsx's own "icon + color alone can't
// convey status to assistive tech (WCAG 1.4.1)" `sr-only` idiom: every row
// gets a real, localized, visually-hidden text label naming its action.
const ACTION_LABEL_KEY: Record<CheckinActionRow["action"], string> = {
  checkin: "monitorRecentActionCheckin",
  undo: "monitorRecentActionUndo",
  reprint: "monitorRecentActionReprint",
};

export interface RecentFeedCardProps {
  recent: CheckinActionRow[];
  stations: MonitorStationRow[];
  zones: MonitorZone[];
}

// Hand-rolled UTC HH:MM:SS formatter -- same convention (duplicated
// per-file on purpose) as VerdictCard.tsx's/RecentScansRail.tsx's own
// formatUtcHHMM: a viewer's local timezone must never shift a
// server-recorded check-in-domain moment. Seconds are included here (board
// 7e's "Last scans" rows are the ONLY monitor-screen timestamps precise
// enough to need them -- Totals/peak only need HH:MM).
function formatUtcHHMMSS(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function zoneNameFor(row: CheckinActionRow, stations: MonitorStationRow[], zones: MonitorZone[]): string | null {
  if (!row.station_id) return null;
  const station = stations.find((s) => s.id === row.station_id);
  if (!station || !station.zone_id) return null;
  const zone = zones.find((z) => z.zone_id === station.zone_id);
  return zone ? zone.name : null;
}

export function RecentFeedCard({ recent, stations, zones }: RecentFeedCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="flex flex-1 flex-col" data-testid="monitor-recent-card">
      <CardHeader>
        <CardTitle>{t("monitorRecentTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {recent.length === 0 ? (
          <p className="text-body text-muted-foreground">{t("monitorRecentEmpty")}</p>
        ) : (
          recent.map((row) => {
            const zoneName = zoneNameFor(row, stations, zones);
            const Icon = row.action === "checkin" ? CheckCircle2 : row.action === "undo" ? RotateCcw : Printer;
            const iconClass = row.action === "checkin" ? verdictClasses.allowed.text : "text-muted-foreground";
            return (
              <div
                key={row.id}
                className="flex items-center gap-2 text-body"
                data-testid={`monitor-recent-row-${row.id}`}
              >
                <Icon aria-hidden className={`size-4 shrink-0 ${iconClass}`} />
                <span className="sr-only" data-testid={`monitor-recent-action-${row.id}`}>
                  {t(ACTION_LABEL_KEY[row.action])}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-foreground">
                    {row.attendee.first_name} {row.attendee.last_name}
                  </span>
                  {zoneName ? (
                    <span
                      className="ml-1 text-muted-foreground"
                      data-testid={`monitor-recent-zone-${row.id}`}
                    >
                      · {zoneName}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-caption text-muted-foreground">
                  {formatUtcHHMMSS(row.created_at)}
                </span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
