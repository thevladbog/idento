import {
  Avatar, AvatarFallback, Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, StatusPill,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { EditAttendeeForm } from "./EditAttendeeForm";
import {
  ATTENDEES_LIST_KEY, ATTENDEE_DETAIL_KEY, ATTENDEE_ZONE_ACCESS_KEY, useAttendeeDetail, useAttendeeZoneAccess,
  useAttendeeZoneHistory, useEventZones,
} from "./hooks";
import { $api } from "../../shared/api/query";
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
// p2-board-3e-6b-6c-extract.md §2). Task 8 built the shell and every
// read-only section; this task (P2.1 Task 9) wires the action row's "Edit
// details" button, the zone chip picker's "+ Zone" affordance, and the
// footer's "Regenerate code…"/"Delete…" confirm flows.
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
          // Keyed by attendee id: if the caller ever swaps to a different
          // attendee while the drawer stays mounted (e.g. clicking another
          // row without closing first), this remounts DrawerBody from
          // scratch — resetting edit mode, in-flight mutation session refs,
          // and any dialog state — rather than carrying stale UI state
          // (edit form open, a pending regenerate confirm, etc.) over to a
          // completely different attendee's data.
          <DrawerBody
            key={attendeeQuery.data.id}
            eventId={eventId}
            attendee={attendeeQuery.data}
            zoneAccess={zoneAccessQuery.data}
            zoneAccessLoading={zoneAccessQuery.isLoading}
            zoneAccessError={zoneAccessQuery.isError}
            zoneHistory={zoneHistoryQuery.data}
            zoneHistoryLoading={zoneHistoryQuery.isLoading}
            zoneHistoryError={zoneHistoryQuery.isError}
            zones={zonesQuery.data}
            zonesLoading={zonesQuery.isLoading}
            onClose={onClose}
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
  eventId: string;
  attendee: Attendee;
  zoneAccess: AttendeeZoneAccess[] | undefined;
  zoneAccessLoading: boolean;
  zoneAccessError: boolean;
  zoneHistory: MovementHistoryEntry[] | undefined;
  zoneHistoryLoading: boolean;
  zoneHistoryError: boolean;
  zones: (EventZone | EventZoneWithStats)[] | undefined;
  zonesLoading: boolean;
  onClose: () => void;
}

function DrawerBody({
  eventId, attendee, zoneAccess, zoneAccessLoading, zoneAccessError, zoneHistory, zoneHistoryLoading,
  zoneHistoryError, zones, zonesLoading, onClose,
}: DrawerBodyProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fullName = `${attendee.first_name} ${attendee.last_name}`.trim();

  // "view" is the read-only shell Task 8 built; "edit" swaps the ENTIRE
  // body for EditAttendeeForm rather than turning individual fields inline
  // — the header/status pill/zone-access/activity/footer sections all stay
  // meaningful without a currently-being-edited attendee's fields
  // interleaved among them, and it avoids overlapping two independent
  // pieces of mutable state (the profile-edit form's dirty-tracking vs. the
  // zone chips' own add/remove affordances) in one render tree.
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [justSaved, setJustSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  const zoneNameById = new Map((zones ?? []).map(zoneIdentity).map((z) => [z.id, z.name]));
  function resolveZoneName(zoneId: string): string {
    // Honest fallback for an id the current zones list can't resolve
    // (deleted zone, race with a still-loading zones query, etc.) — never
    // crash, never show "undefined".
    return zoneNameById.get(zoneId) ?? zoneId.slice(0, 8);
  }

  const allowedZones = (zoneAccess ?? []).filter((entry) => entry.allowed);
  const grantedZoneIds = new Set(allowedZones.map((entry) => entry.zone_id));
  const availableZones = (zones ?? []).map(zoneIdentity).filter((z) => !grantedZoneIds.has(z.id));
  const recentActivity = (zoneHistory ?? []).slice(0, RECENT_ACTIVITY_LIMIT);

  const checkedInParts = [t("drawerCheckedIn")];
  if (attendee.checked_in_at) checkedInParts.push(formatUtcHHMM(attendee.checked_in_at));
  if (attendee.checked_in_point_name) checkedInParts.push(attendee.checked_in_point_name);

  // Zone add/remove: per-click, not a batched/confirm-dialog flow (unlike
  // BulkBar's sequential per-attendee mutations), so there's no "cancel
  // while pending" dialog session to guard against — a click either fires
  // or it doesn't, and there's no local UI state here that a late response
  // could corrupt. Both invalidate ONLY the zone-access query: a zone-access
  // override doesn't change any field on the Attendee resource itself.
  const addZoneAccess = $api.useMutation("post", "/api/attendees/{attendee_id}/zone-access", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_ZONE_ACCESS_KEY(attendee.id) });
    },
  });
  const removeZoneAccess = $api.useMutation("delete", "/api/attendee-zone-access/{id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_ZONE_ACCESS_KEY(attendee.id) });
    },
  });

  // Regenerate code: tier-1 (not typed) destructive confirm. Same
  // session-id-ref cancel guard as DangerZoneCard.tsx/ApiKeysCard.tsx —
  // `regenerateCode.reset()` on close only detaches the mutation observer,
  // it does not cancel an in-flight PATCH or stop a late onSuccess/onError
  // from firing. Cache invalidation runs unconditionally (the code
  // genuinely changed server-side even if the user "cancelled" the dialog
  // before the response landed); only the dialog-closing/error-surfacing
  // UI reactions are gated on the session check.
  const [regenerateOpen, setRegenerateOpen] = React.useState(false);
  const [regenerateError, setRegenerateError] = React.useState(false);
  const regenerateSessionRef = React.useRef(0);

  const regenerateCode = $api.useMutation("patch", "/api/attendees/{id}", {
    onMutate: () => ({ sessionId: regenerateSessionRef.current }),
    onSuccess: (_data, _vars, onMutateResult) => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_DETAIL_KEY(attendee.id) });
      if (onMutateResult?.sessionId !== regenerateSessionRef.current) return;
      setRegenerateOpen(false);
    },
    onError: (_error, _vars, onMutateResult) => {
      if (onMutateResult?.sessionId !== regenerateSessionRef.current) return;
      setRegenerateError(true);
    },
  });

  function handleRegenerateOpenChange(open: boolean) {
    if (!open) {
      // Any response still in flight from this session is now permanently
      // stale — a later reopen gets a new session id, so it can never match
      // again, even across a second cancel-then-reopen cycle.
      regenerateSessionRef.current += 1;
      setRegenerateError(false);
      regenerateCode.reset();
    }
    setRegenerateOpen(open);
  }

  // Delete attendee: tier-1 (not typed — a single-attendee delete, not the
  // bulk/event-wide ops that use typed confirmation) destructive confirm.
  // Same session-id-ref guard shape as regenerate above. On success this
  // closes the WHOLE drawer via `onClose` (the same mechanism the drawer's
  // built-in Sheet close affordance uses, which clears the `?attendee=`
  // search param — see AttendeesPage.tsx's closeAttendee) rather than just
  // this confirm dialog, since the attendee this drawer is showing no
  // longer exists.
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState(false);
  const deleteSessionRef = React.useRef(0);

  const deleteAttendee = $api.useMutation("delete", "/api/attendees/{id}", {
    onMutate: () => ({ sessionId: deleteSessionRef.current }),
    onSuccess: (_data, _vars, onMutateResult) => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setDeleteOpen(false);
      onClose();
    },
    onError: (_error, _vars, onMutateResult) => {
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setDeleteError(true);
    },
  });

  function handleDeleteOpenChange(open: boolean) {
    if (!open) {
      deleteSessionRef.current += 1;
      setDeleteError(false);
      deleteAttendee.reset();
    }
    setDeleteOpen(open);
  }

  if (mode === "edit") {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="bg-success/10 text-caption font-semibold text-success">
              {initials(attendee.first_name, attendee.last_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-0.5">
            <p className="text-body font-bold text-foreground">{fullName}</p>
            <p className="text-caption text-muted-foreground">
              {attendee.company ? `${attendee.company} · ` : ""}
              <span className="font-mono">{attendee.code}</span>
            </p>
          </div>
        </div>
        <EditAttendeeForm
          attendee={attendee}
          eventId={eventId}
          onCancel={() => setMode("view")}
          onSaved={() => {
            setMode("view");
            setJustSaved(true);
            window.clearTimeout(savedTimeoutRef.current);
            savedTimeoutRef.current = window.setTimeout(() => setJustSaved(false), 2000);
          }}
        />
      </div>
    );
  }

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

      {/* 3. Action row. */}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => setMode("edit")}>
          {t("drawerEdit")}
        </Button>
        {/* Permanently locked — depends on the badge editor, which doesn't
            exist yet in this phase; no future P2.1 task wires this. */}
        <Button type="button" variant="outline" className="flex-1" disabled aria-disabled="true">
          {t("drawerReprintLocked")}
        </Button>
      </div>
      {justSaved ? <span className="text-caption text-muted-foreground">{t("settingsSaved")}</span> : null}

      {/* 4. Zone access — success chips for allowed=true rows, resolved to
          zone names, each with a small remove (×) affordance keyed on the
          zone-access ROW id (not the zone id — DELETE
          /api/attendee-zone-access/{id} needs the row). Dashed "+ Zone"
          add-chip opens a dropdown of zones not yet granted. A failed
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
            allowedZones.map((entry) => {
              const name = resolveZoneName(entry.zone_id);
              const removing = removeZoneAccess.isPending && removeZoneAccess.variables?.params.path.id === entry.id;
              return (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1 rounded-full border border-transparent bg-success/10 pl-2.5 pr-1 py-0.5 text-caption font-medium text-success"
                >
                  {name}
                  <button
                    type="button"
                    aria-label={t("drawerRemoveZone", { name })}
                    disabled={removing}
                    className="rounded-full px-1 leading-none text-success/70 hover:text-success disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => removeZoneAccess.mutate({ params: { path: { id: entry.id } } })}
                  >
                    ×
                  </button>
                </span>
              );
            })
          )}
          {/* Hidden while the zone-access fetch is errored: offering to add
              MORE zones when we don't actually know the attendee's current
              zone access is confusing UI. */}
          {zoneAccessError ? null : availableZones.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={addZoneAccess.isPending}
                  className="inline-flex items-center rounded-full border border-dashed border-input px-2.5 py-0.5 text-caption text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("drawerAddZone")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {availableZones.map((zone) => (
                  <DropdownMenuItem
                    key={zone.id}
                    onSelect={() =>
                      addZoneAccess.mutate({
                        params: { path: { attendee_id: attendee.id } },
                        body: { zone_id: zone.id, allowed: true },
                      })
                    }
                  >
                    {zone.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
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

      {/* 6. Footer — pinned to the bottom, destructive-red links. */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <button
          type="button"
          className="text-caption text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            setRegenerateError(false);
            setRegenerateOpen(true);
          }}
        >
          {t("drawerRegenerate")}
        </button>
        <button
          type="button"
          className="text-caption text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            setDeleteError(false);
            setDeleteOpen(true);
          }}
        >
          {t("drawerDelete")}
        </button>
      </div>

      <ConfirmDialog
        open={regenerateOpen}
        onOpenChange={handleRegenerateOpenChange}
        title={t("drawerRegenerateTitle")}
        description={
          regenerateError ? (
            <>
              {t("drawerRegenerateBody")}
              <span className="mt-1 block text-destructive">{t("drawerMutationError")}</span>
            </>
          ) : (
            t("drawerRegenerateBody")
          )
        }
        confirmLabel={t("drawerRegenerateConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={regenerateCode.isPending}
        onConfirm={() => {
          setRegenerateError(false);
          regenerateCode.mutate({ params: { path: { id: attendee.id } }, body: { code: crypto.randomUUID() } });
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        title={t("drawerDeleteTitle")}
        description={
          deleteError ? (
            <>
              {t("drawerDeleteBody", { name: fullName })}
              <span className="mt-1 block text-destructive">{t("drawerMutationError")}</span>
            </>
          ) : (
            t("drawerDeleteBody", { name: fullName })
          )
        }
        confirmLabel={t("drawerDeleteConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={deleteAttendee.isPending}
        onConfirm={() => {
          setDeleteError(false);
          deleteAttendee.mutate({ params: { path: { id: attendee.id } } });
        }}
      />
    </div>
  );
}
