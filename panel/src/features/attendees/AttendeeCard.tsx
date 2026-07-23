import { Button, QrDisplay, Skeleton } from "@idento/ui";
import { ArrowLeft, IdCard, ShieldOff } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { CheckInConfirmSheet } from "./CheckInConfirmSheet";
import { useAttendeeDetail, useAttendeeZoneAccess } from "./hooks";

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
  // Fetched here but only RENDERED by Task 6's checked-in variant, which
  // lands in the very next dispatch on this same branch/file. Verified in
  // isolation (this task's own dispatch, before Task 6 exists) that both
  // eslint's no-unused-vars AND tsc's noUnusedLocals genuinely flag this as
  // dead -- the brief's suggested `_zoneAccess` prefix silences eslint but
  // NOT tsc (TypeScript's noUnusedLocals, unlike noUnusedParameters, does
  // not special-case a leading underscore), so `npm run typecheck` would
  // still fail. `void zoneAccess` marks the binding as read for both tools
  // without changing its name, so Task 6 can drop this line and start
  // reading `zoneAccess.data` with a one-line diff. See task-5-report.md.
  const zoneAccess = useAttendeeZoneAccess(attendeeId);
  void zoneAccess;
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);

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

  if (qrOpen) {
    return (
      <QrDisplay
        value={attendee.code}
        title={fullName}
        subtitle={attendee.company ?? ""}
        expiresAt={null}
        expiredLabel=""
        regenerateLabel=""
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

          <Button className="flex-col gap-0.5 py-2.5" onClick={() => setConfirmOpen(true)}>
            <span className="text-body font-bold">{t("attendeeCardCheckInManually")}</span>
            <span className="text-caption font-normal text-primary-foreground/85">{t("attendeeCardNoBadgeSublabel")}</span>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1 gap-1.5" onClick={() => setQrOpen(true)}>
              <IdCard aria-hidden className="size-4" />
              {t("attendeeCardShowQr")}
            </Button>
            <Button variant="outline" className="min-h-11 flex-1 gap-1.5 text-destructive" onClick={() => {}}>
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
              /* Task 6 wires the undo toast here. */
            }}
          />
        </>
      ) : null}
    </div>
  );
}
