import {
  Button, Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@idento/ui";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationCheckin } from "../checkin/hooks";

export interface CheckInConfirmSheetProps {
  eventId: string;
  attendeeId: string;
  attendeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckedIn: () => void;
}

// Board 8j — the confirm ceremony for manual check-in from the phone
// attendee card. The "no badge will be printed" notice is a structural
// block (icon + bold lead + body), never fine print, per the design
// brief's explicit requirement. station_id is intentionally omitted from
// the request — a station-less check-in is a valid, documented case
// (StationCheckinRequest.station_id is optional) and exactly matches
// "this is a manual phone action, not a kiosk scan."
export function CheckInConfirmSheet({
  eventId, attendeeId, attendeeName, open, onOpenChange, onCheckedIn,
}: CheckInConfirmSheetProps) {
  const { t } = useTranslation();
  const checkin = useStationCheckin(eventId);

  function handleConfirm() {
    checkin.mutate(
      { params: { path: { event_id: eventId } }, body: { attendee_id: attendeeId } },
      {
        onSuccess: () => {
          onOpenChange(false);
          onCheckedIn();
        },
      },
    );
  }

  // Guards every dismiss path (Escape/outside-click) while the check-in
  // mutation is in flight -- same convention RecentScansRail.tsx's
  // preventUndoDialogDismiss/preventReprintDialogDismiss establish and
  // panel/AGENTS.md's "Multi-step async dialogs" rule requires: without
  // this, the sheet would close immediately on Escape/outside-click, but
  // the mutation's onSuccess (wired to an undo toast) would still fire
  // afterward for an action the user believed they'd cancelled.
  function preventDismissWhilePending(event: Event) {
    if (checkin.isPending) event.preventDefault();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={t("moreSheetCloseLabel")}
        onEscapeKeyDown={preventDismissWhilePending}
        onPointerDownOutside={preventDismissWhilePending}
        onInteractOutside={preventDismissWhilePending}
      >
        <SheetHeader>
          <SheetTitle>{t("checkinConfirmTitle", { name: attendeeName })}</SheetTitle>
        </SheetHeader>
        <p className="text-caption text-muted-foreground">{t("checkinConfirmSubtitle")}</p>
        <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <CircleAlert aria-hidden className="mt-0.5 size-4 flex-none text-warning" />
          <p className="text-caption text-foreground">
            <span className="font-bold">{t("checkinConfirmNoBadgeTitle")}</span> {t("checkinConfirmNoBadgeBody")}
          </p>
        </div>
        {checkin.isError ? <p className="text-caption text-destructive">{t("checkinConfirmError")}</p> : null}
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="flex-1"
            disabled={checkin.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("checkinConfirmCancel")}
          </Button>
          <Button className="flex-[1.4]" onClick={handleConfirm} disabled={checkin.isPending}>
            {t("checkinConfirmAction")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
