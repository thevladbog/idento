import { Button, Card, Progress, Skeleton, StatusPill } from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { formatDateRange } from "../events/eventDates";
import { isDateOnly, type ApiEvent } from "../events/eventTiming";
import { useEventReadiness } from "../events/hooks";
import { useMonitorSnapshot } from "../monitor/hooks";
import { useMonitorStream } from "../monitor/useMonitorStream";

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
// alone is still optional). When every dated field in play is a bare
// calendar date (the create dialog's UTC-midnight placeholders, not a real
// time), showing a formatted "12:00 AM–12:00 AM" range would be a fabricated
// time no one entered — an "all day" label is shown instead.
function formatRunningWindow(event: ApiEvent, locale: string, allDayLabel: string): string | null {
  const parts: string[] = [];
  if (event.location) parts.push(event.location);
  if (event.start_date) {
    const allDay = isDateOnly(event.start_date) && (!event.end_date || isDateOnly(event.end_date));
    if (allDay) {
      parts.push(allDayLabel);
    } else {
      const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
      const start = timeFmt.format(new Date(event.start_date));
      const end = event.end_date ? timeFmt.format(new Date(event.end_date)) : null;
      parts.push(end ? `${start}–${end}` : start);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// P4.2 Task 9 -- RunningCard's counters/progress used to come from
// `useEventStats(event.id, {poll: true})` (15s polling) plus a dead
// `stats.data?.zone_stats` read (always undefined -- that field only
// appears with a `?zone=` param the hook never sent; it's the unrelated P2
// per-VERDICT access-control breakdown, not a per-zone-name one). Both are
// replaced by Task 5/6's live monitor data layer: `useMonitorSnapshot`
// fetches the same totals/zones the monitor page itself renders (board 7e),
// kept fresh by `useMonitorStream`'s SSE-driven invalidation instead of a
// poller -- the stream's own `status` isn't surfaced here (no reconnecting
// badge on the home strip; that's the monitor page's own concern), it's
// mounted purely for its invalidation side effect. That includes
// `status === "error"` (PR #81 bot round Finding C3 -- a terminal stream
// failure): this card still doesn't render a dedicated indicator for it,
// matching its pre-existing non-treatment of stream status -- the global
// handling that status triggers (session redirect / suspension takeover,
// useMonitorStream.ts's own `handleApiError` call) runs regardless of who
// mounted the hook, so there's nothing else for THIS card to do.
function RunningCard({ event }: { event: ApiEvent }) {
  const { t, i18n } = useTranslation();
  const snapshot = useMonitorSnapshot(event.id);
  useMonitorStream(event.id);
  const total = snapshot.data?.totals.total ?? 0;
  const checkedIn = snapshot.data?.totals.checked_in ?? 0;
  const zones = snapshot.data?.zones ?? [];
  const unattributed = snapshot.data?.unattributed ?? 0;
  const timing = formatRunningWindow(event, i18n.language, t("homeAllDay"));

  return (
    <Card className="border-success/30 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 pb-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* PR #81 bot round Finding C1: composed from @idento/ui's
              StatusPill (`indicator="dot" pulse`) instead of hand-rolled
              markup -- panel/AGENTS.md's "UI primitives come only from
              @idento/ui". Always pulsing (unlike the monitor page's own
              LIVE pill, whose ring is gated on the stream's `live` status):
              this badge means "the EVENT is currently running", not "the
              SSE connection is up". */}
          <StatusPill status="ready" label={t("homeLiveNow")} indicator="dot" pulse className="font-bold uppercase" />
          <span className="text-card-title">{event.name}</span>
          {timing ? <span className="text-caption text-muted-foreground">{timing}</span> : null}
        </div>
        {/* Board 1c/1d precedent (p4.2-board-7e-extract.md): "Open monitor"
            sits beside the running card's existing CTA. */}
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/events/$eventId/monitor" params={{ eventId: event.id }}>
              {t("homeOpenMonitor")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/events/$eventId" params={{ eventId: event.id }}>
              {t("homeOpenEvent")}
            </Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4 pt-2">
        {/* PR #81 bot round Finding C6: gated on `!snapshot.data` alone, not
            `snapshot.isError` -- once the snapshot has loaded once, a
            single failed background refetch (isError=true, data still
            retained per react-query) must not blank the counters back into
            this error message. */}
        {snapshot.isLoading ? (
          <Skeleton className="h-8 w-40" />
        ) : !snapshot.data ? (
          <p className="text-body text-destructive">{t("homeStatsLoadError")}</p>
        ) : (
          <p>
            <span className="text-2xl font-extrabold text-foreground">{checkedIn}</span>
            <span className="text-body text-muted-foreground">
              {" "}
              / {total} {t("homeCheckedIn")}
            </span>
          </p>
        )}
        {!snapshot.isLoading && snapshot.data ? (
          <>
            <Progress value={checkedIn} max={total} className="w-56" />
            {/* Compact per-zone mini-line (board 1c/1d): real zone-name +
                count pairs from the monitor snapshot, unattributed shown
                only when > 0 (an event with perfect zone coverage never
                shows a permanent empty "Unattributed: 0"). */}
            {zones.length > 0 || unattributed > 0 ? (
              <div className="flex flex-wrap gap-3 text-caption text-muted-foreground">
                {zones.map((zone) => (
                  <span key={zone.zone_id} data-testid={`home-zone-${zone.zone_id}`}>
                    {zone.name}: {zone.checked_in}
                  </span>
                ))}
                {unattributed > 0 ? (
                  <span data-testid="home-zone-unattributed">
                    {/* PR #81 bot round Finding C7: home-owned copy -- this
                        card no longer borrows the monitor page's
                        `monitorUnattributed` key (panel/AGENTS.md's
                        cross-surface i18n convention). */}
                    {t("homeZoneUnattributed")}: {unattributed}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
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
