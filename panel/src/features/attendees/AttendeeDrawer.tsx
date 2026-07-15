import {
  Avatar, AvatarFallback, Button, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, StatusPill,
} from "@idento/ui";
import { useTranslation } from "react-i18next";
import { useAttendeeDetail, useAttendeeZoneAccess, useAttendeeZoneHistory, useEventZones } from "./hooks";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];
type AttendeeZoneAccess = components["schemas"]["AttendeeZoneAccess"];
type MovementHistoryEntry = components["schemas"]["MovementHistoryEntry"];
type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

const RECENT_ACTIVITY_LIMIT = 3;

// Same narrowing helper as AttendeesPage.tsx's/BulkBar.tsx's zoneIdentity —
// useEventZones' return type is a union not discriminated by any param this
// drawer sends.
function zoneIdentity(entry: EventZone | EventZoneWithStats): { id: string; name: string } {
  return "zone" in entry ? { id: entry.zone.id, name: entry.zone.name } : { id: entry.id, name: entry.name };
}

// Board 3e / task brief: times are rendered "HH:MM" pinned to UTC (same
// rationale as EventRow.tsx/eventDates.ts — a viewer's local timezone must
// not shift a server-recorded check-in time). Hand-rolled rather than
// Intl.DateTimeFormat so the 24h zero-padded "HH:MM" shape is guaranteed
// identical in both locales instead of depending on locale formatting
// conventions.
function formatUtcHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase();
}

export interface AttendeeDrawerProps {
  eventId: string;
  attendeeId: string;
  onClose: () => void;
}

// Board 3e (the drawer winner over the 3d full page — see
// p2-board-3e-6b-6c-extract.md §2). This task (P2.1 Task 8) builds the
// shell and every read-only section; Task 9 wires the action row's "Edit
// details" button, the zone chip picker's "+ Zone" affordance, and the
// footer's "Regenerate code…"/"Delete…" typed-confirm flows — all four
// render here already, permanently `disabled`, so Task 9 only has to flip
// them on rather than build them from scratch.
export function AttendeeDrawer({ eventId, attendeeId, onClose }: AttendeeDrawerProps) {
  const { t } = useTranslation();
  const attendeeQuery = useAttendeeDetail(attendeeId);
  const zoneAccessQuery = useAttendeeZoneAccess(attendeeId);
  const zoneHistoryQuery = useAttendeeZoneHistory(attendeeId);
  const zonesQuery = useEventZones(eventId);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" closeLabel={t("workspaceDialogClose")} className="w-[400px] max-w-[400px]">
        {/* Always-present, visually-hidden accessible title — decoupled
            from the visible bold attendee name (rendered inside the loaded
            body below) so the dialog has a valid accessible name in every
            state (loading/error/loaded), not just once data has arrived. */}
        <SheetHeader className="sr-only">
          <SheetTitle>{t("drawerTitleFallback")}</SheetTitle>
        </SheetHeader>

        {attendeeQuery.isLoading ? (
          <DrawerSkeleton />
        ) : attendeeQuery.isError || !attendeeQuery.data ? (
          <p className="text-body text-destructive">{t("drawerLoadError")}</p>
        ) : (
          <DrawerBody
            attendee={attendeeQuery.data}
            zoneAccess={zoneAccessQuery.data}
            zoneAccessLoading={zoneAccessQuery.isLoading}
            zoneAccessError={zoneAccessQuery.isError}
            zoneHistory={zoneHistoryQuery.data}
            zoneHistoryLoading={zoneHistoryQuery.isLoading}
            zoneHistoryError={zoneHistoryQuery.isError}
            zones={zonesQuery.data}
            zonesLoading={zonesQuery.isLoading}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerSkeleton() {
  return (
    <div data-testid="attendee-drawer-skeleton" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-6 w-44 rounded-full" />
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}

interface DrawerBodyProps {
  attendee: Attendee;
  zoneAccess: AttendeeZoneAccess[] | undefined;
  zoneAccessLoading: boolean;
  zoneAccessError: boolean;
  zoneHistory: MovementHistoryEntry[] | undefined;
  zoneHistoryLoading: boolean;
  zoneHistoryError: boolean;
  zones: (EventZone | EventZoneWithStats)[] | undefined;
  zonesLoading: boolean;
}

function DrawerBody({
  attendee, zoneAccess, zoneAccessLoading, zoneAccessError, zoneHistory, zoneHistoryLoading, zoneHistoryError,
  zones, zonesLoading,
}: DrawerBodyProps) {
  const { t } = useTranslation();
  const fullName = `${attendee.first_name} ${attendee.last_name}`.trim();

  const zoneNameById = new Map((zones ?? []).map(zoneIdentity).map((z) => [z.id, z.name]));
  function resolveZoneName(zoneId: string): string {
    // Honest fallback for an id the current zones list can't resolve
    // (deleted zone, race with a still-loading zones query, etc.) — never
    // crash, never show "undefined".
    return zoneNameById.get(zoneId) ?? zoneId.slice(0, 8);
  }

  const allowedZones = (zoneAccess ?? []).filter((entry) => entry.allowed);
  const recentActivity = (zoneHistory ?? []).slice(0, RECENT_ACTIVITY_LIMIT);

  const checkedInParts = [t("drawerCheckedIn")];
  if (attendee.checked_in_at) checkedInParts.push(formatUtcHHMM(attendee.checked_in_at));
  if (attendee.checked_in_point_name) checkedInParts.push(attendee.checked_in_point_name);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 1. Header: 36px initials avatar + bold name + "{company} · {code}"
          subline (company omitted gracefully when blank). */}
      <div className="flex items-start gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarFallback className="bg-success/10 text-caption font-semibold text-success">
            {initials(attendee.first_name, attendee.last_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-0.5">
          <p className="text-body font-bold text-foreground">{fullName}</p>
          <p data-testid="attendee-drawer-subline" className="text-caption text-muted-foreground">
            {attendee.company ? `${attendee.company} · ` : ""}
            <span className="font-mono">{attendee.code}</span>
          </p>
        </div>
      </div>

      {/* 2. Status pill row — own row, not inline with the header. WCAG
          1.4.1: icon + text + color together, never color alone. */}
      <div>
        {attendee.checkin_status ? (
          <StatusPill status="ready" label={checkedInParts.join(" · ")} />
        ) : (
          <StatusPill status="empty" label={t("drawerNotCheckedIn")} />
        )}
      </div>

      {/* 3. Action row — both disabled in this task; see the module-level
          comment for what Task 9 does with each. */}
      <div className="flex gap-2">
        {/* Task 9 enables and wires this (edit-details form + mutation). */}
        <Button type="button" variant="outline" className="flex-1" disabled aria-disabled="true">
          {t("drawerEdit")}
        </Button>
        {/* Permanently locked — depends on the badge editor, which doesn't
            exist yet in this phase; no future P2.1 task wires this. */}
        <Button type="button" variant="outline" className="flex-1" disabled aria-disabled="true">
          {t("drawerReprintLocked")}
        </Button>
      </div>

      {/* 4. Zone access — success chips for allowed=true rows, resolved to
          zone names; dashed "+ Zone" add-chip (Task 9 wires it). A failed
          zone-access fetch gets its own honest error message rather than
          silently rendering identically to "no zone access" — this is a
          check-in-adjacent tool, so an operator glancing at the drawer
          during a transient failure must not be able to mistake "we don't
          know" for "this attendee genuinely has none". */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-caption font-medium uppercase text-muted-foreground">{t("drawerZoneAccess")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {zoneAccessLoading || zonesLoading ? (
            <>
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </>
          ) : zoneAccessError ? (
            <p className="text-caption text-destructive">{t("drawerZoneAccessLoadError")}</p>
          ) : (
            allowedZones.map((entry) => (
              <span
                key={entry.id}
                className="inline-flex items-center rounded-full border border-transparent bg-success/10 px-2.5 py-0.5 text-caption font-medium text-success"
              >
                {resolveZoneName(entry.zone_id)}
              </span>
            ))
          )}
          {/* Task 9 wires this (zone chip picker). Hidden while the
              zone-access fetch is errored: offering to add MORE zones when
              we don't actually know the attendee's current zone access is
              confusing UI, so we show nothing here rather than an
              affordance that could contradict reality once the fetch
              eventually succeeds. */}
          {zoneAccessError ? null : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center rounded-full border border-dashed border-input px-2.5 py-0.5 text-caption text-muted-foreground disabled:cursor-not-allowed"
            >
              {t("drawerAddZone")}
            </button>
          )}
        </div>
      </div>

      {/* 5. Recent activity — up to 3 rows, API order trusted verbatim
          (most-recent-first per the backend contract), zone_name only (no
          device field — the API doesn't return one, and this task doesn't
          fabricate data). No "Full timeline →" link — the plan explicitly
          excludes it since the target full-page view isn't built in P2. */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-caption font-medium uppercase text-muted-foreground">{t("drawerActivity")}</span>
        {zoneHistoryLoading ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : zoneHistoryError ? (
          <p className="text-caption text-destructive">{t("drawerActivityLoadError")}</p>
        ) : recentActivity.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("drawerNoActivity")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentActivity.map((entry) => (
              <li key={entry.checkin.id} className="text-caption text-muted-foreground">
                {formatUtcHHMM(entry.checkin.checked_in_at)} — {entry.zone_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6. Footer — pinned to the bottom, destructive-red links, both
          disabled (Task 9 wires the typed-confirm regenerate/delete
          flows). */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        {/* Task 9 wires this. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="text-caption text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("drawerRegenerate")}
        </button>
        {/* Task 9 wires this. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="text-caption text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("drawerDelete")}
        </button>
      </div>
    </div>
  );
}
