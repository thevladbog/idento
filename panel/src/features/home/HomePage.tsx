import { Button, EmptyState, Skeleton } from "@idento/ui";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PastRow, UpcomingRow } from "./EventRow";
import { LiveStrip } from "./LiveStrip";
import { CreateEventDialog } from "../events/CreateEventDialog";
import { splitEvents } from "../events/eventTiming";
import { useEventsQuery } from "../events/hooks";

// Board 1c — LiveStrip hero, then "Upcoming"/"Past" sectioned row lists.
// `createOpen` is defined here now (per Task 7's brief) so Task 8 only has
// to render `<CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} />`
// next to the two triggers below without touching this file's state shape.
export function HomePage() {
  const { t } = useTranslation();
  const eventsQuery = useEventsQuery();
  const [createOpen, setCreateOpen] = useState(false);

  if (eventsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-28 w-full" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (eventsQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-body text-destructive">{t("homeLoadError")}</p>
        <Button variant="outline" onClick={() => void eventsQuery.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const events = eventsQuery.data ?? [];

  if (events.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={CalendarPlus}
          title={t("homeEmptyTitle")}
          description={t("homeEmptyBody")}
          actions={
            <Button aria-expanded={createOpen} onClick={() => setCreateOpen(true)}>
              {t("homeNewEvent")}
            </Button>
          }
        />
        <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  const { running, upcoming, past } = splitEvents(events, new Date());
  const hasRunning = running.length > 0;
  // LiveStrip promotes upcoming[0] into the hero only when nothing is
  // currently running (LiveStrip's own fallback behavior). To avoid
  // showing that same event twice, drop it from the Upcoming list below in
  // that case; when a running event exists, LiveStrip shows the running
  // event instead, so upcoming[0] stays a normal list row.
  const upcomingListEvents = hasRunning ? upcoming : upcoming.slice(1);

  return (
    <div className="flex flex-col gap-6 p-6">
      <LiveStrip running={running[0]} nextUpcoming={upcoming[0]} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-section-title">{t("homeUpcoming")}</h2>
          <Button size="sm" aria-expanded={createOpen} onClick={() => setCreateOpen(true)}>
            {t("homeNewEvent")}
          </Button>
        </div>
        {upcomingListEvents.length > 0 ? (
          <div data-testid="home-upcoming-list" className="divide-y divide-border rounded-lg border border-border bg-card">
            {upcomingListEvents.map((event) => (
              <UpcomingRow key={event.id} event={event} />
            ))}
          </div>
        ) : null}
      </section>

      {past.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-section-title">{t("homePast")}</h2>
          <div data-testid="home-past-list" className="divide-y divide-border rounded-lg border border-border bg-card opacity-90">
            {past.map((event) => (
              <PastRow key={event.id} event={event} />
            ))}
          </div>
        </section>
      ) : null}
      <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
