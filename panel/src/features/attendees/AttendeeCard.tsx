import { Button, ConfirmDialog, QrDisplay, Skeleton } from "@idento/ui";
import { ArrowLeft, Check, IdCard, ShieldOff, Undo2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckInConfirmSheet } from "./CheckInConfirmSheet";
import { useAttendeeDetail, useAttendeeZoneAccess, useBlockAttendee, useEventZones } from "./hooks";
import { useUndoCheckin } from "../checkin/hooks";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

export interface AttendeeCardProps {
  eventId: string;
  attendeeId: string;
  onClose: () => void;
}

function initials(firstName: string, lastName: string): string {
  return `${lastName.slice(0, 1)}${firstName.slice(0, 1)}`.toUpperCase();
}

// Board 8h/8i — the phone sibling of AttendeeDrawer (board 8i's primary-
// button layout for not-checked-in, board 8h's grouped action list for
// checked-in — the locked hybrid decision from the design review). Same
// prop shape as AttendeeDrawer so AttendeesPage's phone branch (Task 7)
// swaps them at one call site.
export function AttendeeCard({ eventId, attendeeId, onClose }: AttendeeCardProps) {
  const { t } = useTranslation();
  const detail = useAttendeeDetail(attendeeId);
  const zoneAccess = useAttendeeZoneAccess(attendeeId);
  const zonesQuery = useEventZones(eventId);
  const undoCheckin = useUndoCheckin(eventId);
  // Lifted to the top of the component (rather than declared only inside the
  // checked-in branch) so BOTH the not-checked-in variant's "Block" button
  // (a Task 5 stub) and the checked-in variant's own destructive Block row
  // can trigger the same dialog/mutation -- an attendee can be blocked
  // whether or not they're checked in (design intent per board 8h/8i), so
  // there's no reason for two separate implementations.
  const blockAttendee = useBlockAttendee(eventId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [undoOpen, setUndoOpen] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);

  if (detail.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-body text-destructive">{t("attendeeCardLoadError")}</p>
        <Button variant="outline" onClick={onClose}>
          {t("attendeeCardBackLabel")}
        </Button>
      </div>
    );
  }

  const attendee = detail.data;
  const fullName = `${attendee.last_name} ${attendee.first_name}`;

  // zoneIdentity normalizes the two possible zones-list response shapes
  // (plain EventZone vs the with_stats-wrapped EventZoneWithStats) to a flat
  // { id, name } pair, matching AttendeesPage.tsx's own zone-filter usage of
  // useEventZones. Only `allowed: true` zone-access rows render as chips —
  // a missing zone name (e.g. the zones list hasn't loaded yet) falls back
  // to a truncated id rather than hiding the chip entirely.
  const zoneNameById = new Map((zonesQuery.data ?? []).map((z) => [zoneIdentity(z).id, zoneIdentity(z).name]));
  const allowedZoneNames = (zoneAccess.data ?? [])
    .filter((entry) => entry.allowed)
    .map((entry) => zoneNameById.get(entry.zone_id) ?? entry.zone_id.slice(0, 8));

  function handleUndoCheckin() {
    undoCheckin.mutate(
      { params: { path: { event_id: eventId } }, body: { attendee_id: attendeeId } },
      { onSuccess: () => setUndoOpen(false) },
    );
  }

  function handleBlock() {
    blockAttendee.mutate(
      { params: { path: { id: attendeeId } }, body: {} },
      { onSuccess: () => setBlockOpen(false) },
    );
  }

  if (qrOpen) {
    return (
      <QrDisplay
        value={attendee.code}
        title={fullName}
        subtitle={attendee.company ?? ""}
        expiresAt={null}
        expiredLabel=""
        // Never rendered: an attendee's QR is a static, non-rotating value,
        // so there's no real regenerate action to wire up, and
        // `showRegenerate={false}` below suppresses the regenerate control
        // entirely. `regenerateLabel` stays a required string prop on
        // QrDisplay (shared by other real-regenerate consumers), so this is
        // an intentionally-unused placeholder rather than an empty string.
        regenerateLabel="regenerate"
        showRegenerate={false}
        closeLabel={t("attendeeCardBackLabel")}
        onClose={() => setQrOpen(false)}
        onRegenerate={() => {}}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} aria-label={t("attendeeCardBackLabel")} className="flex size-11 items-center justify-center">
          <ArrowLeft aria-hidden className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex size-13 flex-none items-center justify-center rounded-full bg-success/10 text-body font-bold text-success">
          {initials(attendee.first_name, attendee.last_name)}
        </span>
        <div className="min-w-0">
          <div className="text-card-title font-bold">{fullName}</div>
          <div className="truncate text-caption text-muted-foreground">
            {attendee.company} · <span className="font-mono">{attendee.code}</span>
          </div>
        </div>
      </div>

      {!attendee.checkin_status ? (
        <>
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted p-3">
            <span className="flex size-7.5 flex-none items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground">
              —
            </span>
            <div>
              <div className="text-body font-bold text-foreground">{t("attendeeCardNotCheckedIn")}</div>
              <div className="text-caption text-muted-foreground">{t("attendeeCardRegisteredCaption")}</div>
            </div>
          </div>

          <Button className="h-auto min-h-13 flex-col gap-0.5 py-2.5" onClick={() => setConfirmOpen(true)}>
            <span className="text-body font-bold">{t("attendeeCardCheckInManually")}</span>
            <span className="text-caption font-normal text-primary-foreground/85">{t("attendeeCardNoBadgeSublabel")}</span>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1 gap-1.5" onClick={() => setQrOpen(true)}>
              <IdCard aria-hidden className="size-4" />
              {t("attendeeCardShowQr")}
            </Button>
            <Button variant="outline" className="min-h-11 flex-1 gap-1.5 text-destructive" onClick={() => setBlockOpen(true)}>
              <ShieldOff aria-hidden className="size-4" />
              {t("attendeeCardBlock")}
            </Button>
          </div>

          <CheckInConfirmSheet
            eventId={eventId}
            attendeeId={attendeeId}
            attendeeName={fullName}
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            onCheckedIn={() => {
              toast.success(t("toastCheckedInNoBadge"), {
                action: { label: t("toastUndo"), onClick: handleUndoCheckin },
              });
            }}
          />
        </>
      ) : (
        <>
          <div className="flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/10 p-3">
            <span className="flex size-7.5 flex-none items-center justify-center rounded-full bg-success text-success-foreground">
              <Check aria-hidden className="size-3.5" />
            </span>
            <div>
              <div className="text-body font-bold text-success">{t("attendeeCardCheckedIn")}</div>
              <div className="text-caption text-success/80">
                {attendee.checked_in_at ? new Date(attendee.checked_in_at).toLocaleTimeString() : null}
                {attendee.checked_in_point_name ? ` · ${attendee.checked_in_point_name}` : ` · ${t("attendeeCardCheckedInNoBadgeCaption")}`}
              </div>
            </div>
          </div>

          {allowedZoneNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="w-full text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {t("attendeeCardZoneAccess")}
              </span>
              {allowedZoneNames.map((name) => (
                <span key={name} className="rounded-full bg-success/10 px-2.5 py-1 text-caption font-semibold text-success">
                  {name}
                </span>
              ))}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-border">
            <button type="button" onClick={() => setQrOpen(true)} className="flex min-h-12 w-full items-center gap-2.5 px-3.5 hover:bg-muted">
              <IdCard aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left text-body font-semibold">{t("attendeeCardShowQr")}</span>
            </button>
            <div className="h-px bg-border" />
            <button type="button" onClick={() => setUndoOpen(true)} className="flex min-h-12 w-full items-center gap-2.5 px-3.5 hover:bg-muted">
              <Undo2 aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left text-body font-semibold">{t("attendeeCardUndoCheckin")}</span>
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-destructive/30">
            <button type="button" onClick={() => setBlockOpen(true)} className="flex min-h-12 w-full items-center gap-2.5 px-3.5 text-destructive hover:bg-destructive/10">
              <ShieldOff aria-hidden className="size-4" />
              <span className="flex-1 text-left text-body font-semibold">{t("attendeeCardBlock")}</span>
            </button>
          </div>

          <ConfirmDialog
            open={undoOpen}
            onOpenChange={setUndoOpen}
            title={t("attendeeCardUndoConfirmTitle")}
            description={t("attendeeCardUndoConfirmBody", { name: fullName })}
            confirmLabel={t("attendeeCardUndoCheckin")}
            cancelLabel={t("attendeeCardConfirmCancel")}
            closeLabel={t("moreSheetCloseLabel")}
            onConfirm={handleUndoCheckin}
          />
        </>
      )}

      {/* Rendered once, outside the checkin-status ternary above, so it's
          reachable from EITHER branch's Block trigger (the not-checked-in
          variant's Block button, and the checked-in variant's own
          destructive Block row both just call setBlockOpen(true)) — an
          attendee can be blocked whether or not they're checked in. */}
      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={t("attendeeCardBlockConfirmTitle", { name: fullName })}
        description={t("attendeeCardBlockConfirmBody")}
        confirmLabel={t("attendeeCardConfirmDestructive")}
        cancelLabel={t("attendeeCardConfirmCancel")}
        closeLabel={t("moreSheetCloseLabel")}
        destructive
        onConfirm={handleBlock}
      />
    </div>
  );
}
