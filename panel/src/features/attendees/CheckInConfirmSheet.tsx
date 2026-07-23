import {
  Button, Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@idento/ui";
import { CircleAlert } from "lucide-react";
import * as React from "react";
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
  // The check-in endpoint is verdict-style: it always returns HTTP 200, even
  // for a blocked attendee (outcome: "blocked", checkin: null — nothing was
  // actually recorded server-side). Tracked as its own boolean, separate from
  // checkin.isError, since a "blocked" verdict is not a request failure.
  const [blockedOutcome, setBlockedOutcome] = React.useState(false);

  // Resets on every open -> closed transition (same pattern as
  // AddAttendeeDialog.tsx's createAttendee.reset() effect) so a stale
  // blocked/error verdict from a previous open never leaks into the next one.
  React.useEffect(() => {
    if (open) return;
    setBlockedOutcome(false);
    checkin.reset();
    // checkin is a fresh mutation object each render; including it in the
    // deps would reset on every render instead of only on the
    // open->closed transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleConfirm() {
    checkin.mutate(
      { params: { path: { event_id: eventId } }, body: { attendee_id: attendeeId } },
      {
        onSuccess: (data) => {
          if (data.outcome === "blocked") {
            // Never actually checked in server-side -- keep the sheet open
            // and show an inline explanation instead of firing the "no
            // badge printed" success toast for an attempt that didn't work.
            setBlockedOutcome(true);
            return;
          }
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
        {blockedOutcome ? (
          <p className="text-caption text-destructive">{t("checkinConfirmBlockedError")}</p>
        ) : checkin.isError ? (
          <p className="text-caption text-destructive">{t("checkinConfirmError")}</p>
        ) : null}
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="flex-1"
            disabled={checkin.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("checkinConfirmCancel")}
          </Button>
          {/* Blocked is a dead end, not a retryable failure -- the endpoint
              never actually checks the attendee in for this outcome, so
              re-submitting would just come back "blocked" again. Disabling
              the primary action leaves Cancel/X as the one clear path back
              to closing, rather than adding a second differently-labeled
              button for the exact same "close" behavior. */}
          <Button className="flex-[1.4]" onClick={handleConfirm} disabled={checkin.isPending || blockedOutcome}>
            {t("checkinConfirmAction")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
