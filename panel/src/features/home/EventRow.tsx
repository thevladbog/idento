import { Skeleton } from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ReadinessCell } from "./ReadinessCell";
import type { ApiEvent } from "../events/eventTiming";
import { useEventReadiness, useEventStats } from "../events/hooks";

// Shared row-hover treatment for both list variants (board 1c §3: row hover
// background, expressed via the `accent` token rather than the board's raw
// `#fafcfb` one-off).
const ROW_BASE = "grid items-center gap-2 p-3 hover:bg-accent/50 md:gap-4 md:p-4";

function formatDate(event: ApiEvent, locale: string): string | null {
  if (!event.start_date) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(event.start_date),
  );
}

export function UpcomingRow({ event }: { event: ApiEvent }) {
  const { t, i18n } = useTranslation();
  const readiness = useEventReadiness(event.id);
  const attendeeCount = readiness.data?.steps.find((step) => step.key === "attendees")?.count ?? 0;
  const attendeesNotDone = readiness.data?.steps.find((step) => step.key === "attendees")?.status === "not_done";
  const dateLabel = formatDate(event, i18n.language);

  return (
    <div className={`${ROW_BASE} grid-cols-1 md:grid-cols-[1fr_130px_110px_220px_150px]`}>
      <div className="flex flex-col">
        <span className="text-card-title">{event.name}</span>
        {event.location ? <span className="text-caption text-muted-foreground">{event.location}</span> : null}
      </div>
      <div className="text-body">{dateLabel ?? "—"}</div>
      <div className={`font-mono text-body ${attendeeCount === 0 ? "text-muted-foreground" : ""}`}>
        {attendeeCount}
      </div>
      <div className="flex items-center justify-between gap-3 md:contents">
        <ReadinessCell readiness={readiness.data} />
        <Link to="/events/$eventId" params={{ eventId: event.id }} className="text-body text-primary hover:underline">
          {attendeesNotDone ? t("homeImportAttendees") : t("homeContinueSetup")}
        </Link>
      </div>
    </div>
  );
}

export function PastRow({ event }: { event: ApiEvent }) {
  const { t, i18n } = useTranslation();
  const stats = useEventStats(event.id);
  const dateLabel = formatDate(event, i18n.language);
  const total = stats.data?.total_attendees ?? 0;
  const checkedIn = stats.data?.checked_in ?? 0;
  const pct = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

  return (
    <div className={`${ROW_BASE} grid-cols-1 md:grid-cols-[1fr_130px_240px_150px]`}>
      <div className="text-card-title text-muted-foreground">{event.name}</div>
      <div className="text-body text-muted-foreground">{dateLabel ?? "—"}</div>
      {stats.isLoading ? (
        <Skeleton className="h-4 w-40" />
      ) : (
        <div className="text-body text-muted-foreground">
          <span className="font-medium text-foreground">
            {checkedIn} / {total}
          </span>{" "}
          {t("homeCheckedIn")} · {pct}%
        </div>
      )}
      <Link to="/events/$eventId" params={{ eventId: event.id }} className="text-body text-primary hover:underline">
        {t("homeReport")}
      </Link>
    </div>
  );
}
