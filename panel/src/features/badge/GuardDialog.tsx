import {
  Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@idento/ui";
import { useTranslation } from "react-i18next";

// Board §4c's "Unsaved-changes guard dialog" (P3.1 Task 11) -- a three-action
// Dialog (NOT the two-tier ConfirmDialog: Discard / Keep / Save is three
// independent choices, not a single confirm/cancel pair), reused in TWO
// distinct contexts by BadgeEditorPage.tsx:
//
//  1. "Navigate mode" -- opened by `useBlocker`'s resolver when the operator
//     tries to leave the badge route (or another tab, or a browser
//     navigation) while dirty. Discard -> `resolver.proceed()`; Keep ->
//     `resolver.reset()`; Save -> the SAME save path as the top-bar Save
//     button, then `resolver.proceed()` on success (never on a 409/failure --
//     BadgeEditorPage.tsx's `performSave` already keeps the conflict banner
//     visible instead of calling the success callback).
//  2. "Revert mode" -- opened by the page-level Escape handler (only when
//     nothing is selected on the canvas -- Task 8's contract) while dirty.
//     There's nowhere to navigate here, so Discard instead reverts the doc to
//     the last-loaded baseline and Save just stays on the page afterward.
//
// This component itself is deliberately mode-agnostic: it only renders the
// (identical, per the brief) title/body copy plus three callbacks + a label
// for the third button (`saveLabel` -- "Save & leave" in navigate mode vs
// "Save" in revert mode, `badgeGuardSave`/`badgeGuardSaveStay`) and a `busy`
// flag that disables all three while a save is in flight. ALL of the
// mode-branching (which callback does what) lives in BadgeEditorPage.tsx, so
// there's exactly one place that decides "what does Discard mean right now".
export interface GuardDialogProps {
  open: boolean;
  busy: boolean;
  saveLabel: string;
  onDiscard: () => void;
  onKeep: () => void;
  onSave: () => void;
}

export function GuardDialog({
  open, busy, saveLabel, onDiscard, onKeep, onSave,
}: GuardDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix funnels every PASSIVE dismiss vector -- Escape while focus is
        // inside the dialog, an overlay click, and the header's own close X
        // (DialogContent's built-in DialogPrimitive.Close) -- through this
        // one callback with `next === false`. Mapping every one of them to
        // "Keep editing" per the brief needs exactly one branch here, and
        // gating it on `busy` here covers all three vectors at once (the
        // brief's "dismiss paths ... are also busy-gated").
        if (!next && !busy) onKeep();
      }}
    >
      <DialogContent closeLabel={t("workspaceDialogClose")}>
        <DialogHeader>
          <DialogTitle>{t("badgeGuardTitle")}</DialogTitle>
          <DialogDescription>{t("badgeGuardBody")}</DialogDescription>
        </DialogHeader>
        {/* Board layout: Discard sits at the far left, Keep/Save cluster at
            the right -- NOT DialogFooter (which right-aligns every child
            under `sm:justify-end`), so this is a hand-rolled row with a
            spacer that only applies once stacked buttons become a row. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <Button type="button" variant="destructive" disabled={busy} onClick={onDiscard}>
            {t("badgeGuardDiscard")}
          </Button>
          <div className="hidden flex-1 sm:block" />
          <Button type="button" variant="outline" disabled={busy} onClick={onKeep}>
            {t("badgeGuardKeep")}
          </Button>
          <Button type="button" disabled={busy} onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
