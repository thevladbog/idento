// P4.2 Task 7 -- the live monitor's "By zone" card (board 7e,
// p4.2-board-7e-extract.md): per-zone label + mini progress bar + count
// (e.g. "Main hall 1,190 / VIP 62 / Backstage 32"), plus an "Unattributed"
// row for checked-in attendees the snapshot's zone aggregation couldn't
// attribute to a zone (backend store.GetMonitorZones' own invariant:
// sum(zones[].checked_in) + unattributed === totals.checked_in) -- shown
// ONLY when > 0, per this task's brief, so an event with perfect zone
// coverage never displays a permanent empty "Unattributed: 0" row.
import { Card, CardContent, CardHeader, CardTitle, Progress } from "@idento/ui";
import { useTranslation } from "react-i18next";
import type { components } from "../../shared/api/schema";

type MonitorZone = components["schemas"]["MonitorZone"];

export interface ZonesCardProps {
  zones: MonitorZone[];
  unattributed: number;
  // The mini progress bars are sized relative to the WHOLE currently-
  // checked-in population (totals.checked_in), not to the largest zone --
  // so a zone's bar length is a direct, comparable read of "what share of
  // everyone checked in is in this zone", matching the "glanceable from
  // across the room" olabel the board extract calls out for this screen.
  checkedInTotal: number;
}

export function ZonesCard({ zones, unattributed, checkedInTotal }: ZonesCardProps) {
  const { t, i18n } = useTranslation();
  const numberFmt = new Intl.NumberFormat(i18n.language);

  return (
    <Card data-testid="monitor-zones-card">
      <CardHeader>
        <CardTitle>{t("monitorZonesTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {zones.map((zone) => (
          <div key={zone.zone_id} className="flex flex-col gap-1" data-testid={`monitor-zone-${zone.zone_id}`}>
            <div className="flex items-center justify-between text-body">
              <span>{zone.name}</span>
              <span className="font-medium text-foreground">{numberFmt.format(zone.checked_in)}</span>
            </div>
            <Progress value={zone.checked_in} max={checkedInTotal} className="h-1.5" />
          </div>
        ))}
        {unattributed > 0 ? (
          <div className="flex flex-col gap-1" data-testid="monitor-zone-unattributed">
            <div className="flex items-center justify-between text-body">
              <span>{t("monitorUnattributed")}</span>
              <span className="font-medium text-foreground">{numberFmt.format(unattributed)}</span>
            </div>
            <Progress value={unattributed} max={checkedInTotal} className="h-1.5" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
