import { StatusPill } from "@idento/ui";
import { useTranslation } from "react-i18next";
import { useAttendeesPage } from "./hooks";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

function attendeeStatus(attendee: Attendee): { status: "ready" | "empty" | "error"; labelKey: string } {
  if (attendee.blocked) return { status: "error", labelKey: "attendeesStatusBlocked" };
  if (attendee.checkin_status) return { status: "ready", labelKey: "attendeesStatusCheckedIn" };
  return { status: "empty", labelKey: "attendeesStatusNotCheckedIn" };
}

export interface AttendeeSearchListProps {
  eventId: string;
  search: string | undefined;
  zone?: string;
  status?: "checked_in" | "not_checked_in";
  onRowClick: (attendeeId: string) => void;
  onSearchChange?: (value: string) => void;
}

const PHONE_PER_PAGE = 30;

// Board 8g — the phone sibling of AttendeeTable: search-first, no bulk
// select, no column editing, no CSV import. Reuses the SAME
// useAttendeesPage hook/query shape as the desktop table (server-side
// search+pagination, no backend change) — only the presentation differs.
export function AttendeeSearchList({ eventId, search, zone, status, onRowClick }: AttendeeSearchListProps) {
  const { t } = useTranslation();
  const query = useAttendeesPage(eventId, { page: 1, perPage: PHONE_PER_PAGE, search, zone, status });
  const rows = query.data?.attendees ?? [];

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2" data-testid="attendee-search-list-skeleton">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="p-4 text-center text-body text-muted-foreground">{t("attendeesSearchNoMatches")}</p>;
  }

  return (
    <div className="flex flex-col">
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((attendee) => {
          const { status: pillStatus, labelKey } = attendeeStatus(attendee);
          return (
            <button
              key={attendee.id}
              type="button"
              onClick={() => onRowClick(attendee.id)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-semibold">
                  {attendee.last_name} {attendee.first_name}
                </div>
                <div className="truncate text-caption text-muted-foreground">
                  {attendee.company ?? ""} {attendee.company ? "·" : ""} {attendee.code}
                </div>
              </div>
              <StatusPill status={pillStatus} label={t(labelKey)} className="flex-none" />
            </button>
          );
        })}
      </div>
      <p className="p-4 text-caption text-muted-foreground">{t("attendeesSearchDesktopHint")}</p>
    </div>
  );
}
