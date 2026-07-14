import { Button, Card, Progress } from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ApiEvent } from "../events/eventTiming";
import { useEventReadiness, useEventStats } from "../events/hooks";

export interface LiveStripProps {
  running: ApiEvent | undefined;
  nextUpcoming: ApiEvent | undefined;
}

// Home's hero — shows the currently-running event (live counters + progress)
// when one exists, else the next upcoming event as a lighter-weight
// call-to-action, else nothing (the all-empty state is Task 7's page-level
// EmptyState, not this component's concern).
export function LiveStrip({ running, nextUpcoming }: LiveStripProps) {
  if (running) return <RunningCard event={running} />;
  if (nextUpcoming) return <UpcomingCard event={nextUpcoming} />;
  return null;
}

// "location · start–end" in the viewer's locale, skipping parts that are
// absent (undated draft events never reach here as `running`, but location
// alone is still optional).
function formatRunningWindow(event: ApiEvent, locale: string): string | null {
  const parts: string[] = [];
  if (event.location) parts.push(event.location);
  if (event.start_date) {
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
    const start = timeFmt.format(new Date(event.start_date));
    const end = event.end_date ? timeFmt.format(new Date(event.end_date)) : null;
    parts.push(end ? `${start}–${end}` : start);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// A single date, or "start – end" when the dates differ, in the viewer's
// locale — no date library per plan constraints.
function formatDateRange(event: ApiEvent, locale: string): string | null {
  if (!event.start_date) return null;
  const dateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const start = dateFmt.format(new Date(event.start_date));
  if (!event.end_date) return start;
  const end = dateFmt.format(new Date(event.end_date));
  return start === end ? start : `${start} – ${end}`;
}

function RunningCard({ event }: { event: ApiEvent }) {
  const { t, i18n } = useTranslation();
  const stats = useEventStats(event.id, { poll: true });
  const total = stats.data?.total_attendees ?? 0;
  const checkedIn = stats.data?.checked_in ?? 0;
  const timing = formatRunningWindow(event, i18n.language);
  const zoneStats = stats.data?.zone_stats;

  return (
    <Card className="border-success/30 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-caption font-bold uppercase text-success">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            {t("homeLiveNow")}
          </span>
          <span className="text-card-title">{event.name}</span>
          {timing ? <span className="text-caption text-muted-foreground">{timing}</span> : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/events/$eventId" params={{ eventId: event.id }}>
            {t("homeOpenEvent")}
          </Link>
        </Button>
      </div>
      <div className="flex flex-col gap-2 p-4 pt-2">
        <p>
          <span className="text-2xl font-extrabold text-foreground">{checkedIn}</span>
          <span className="text-body text-muted-foreground">
            {" "}
            / {total} {t("homeCheckedIn")}
          </span>
        </p>
        <Progress value={checkedIn} max={total} className="w-56" />
        {/* zone_stats is a per-VERDICT breakdown (allowed/no_access/not_registered),
            not a per-zone-name breakdown — there is no zone-name data in this
            endpoint, so it is never rendered as such here. */}
        {zoneStats ? (
          <div className="flex flex-wrap gap-3 text-caption text-muted-foreground">
            <span>
              {t("homeStatsAllowed")}: {zoneStats.allowed}
            </span>
            <span>
              {t("homeStatsNoAccess")}: {zoneStats.no_access}
            </span>
            <span>
              {t("homeStatsNotRegistered")}: {zoneStats.not_registered}
            </span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function UpcomingCard({ event }: { event: ApiEvent }) {
  const { t, i18n } = useTranslation();
  const readiness = useEventReadiness(event.id);
  const steps = readiness.data?.steps;
  const done = steps?.filter((s) => s.status === "done").length ?? 0;
  const total = steps?.filter((s) => s.status !== "skipped").length ?? 0;
  const dateRange = formatDateRange(event, i18n.language);

  return (
    <Card className="shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium uppercase text-muted-foreground">{t("homeNextUp")}</span>
          <span className="text-card-title">{event.name}</span>
          {dateRange ? <span className="text-caption text-muted-foreground">{dateRange}</span> : null}
          {steps ? (
            <span className="text-caption text-muted-foreground">{t("homeReadyFraction", { done, total })}</span>
          ) : null}
        </div>
        <Button asChild size="sm">
          <Link to="/events/$eventId" params={{ eventId: event.id }}>
            {t("homeOpenEvent")}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
