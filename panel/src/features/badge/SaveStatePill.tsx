import { StatusPill, type StatusPillStatus } from "@idento/ui";
import { Loader2, Pencil, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SaveState = "saved" | "saving" | "dirty" | "conflict";

export interface ComputeSaveStateArgs {
  dirty: boolean;
  isPending: boolean;
  conflict: boolean;
  savedAt: string | null;
}

// Priority order matters: "isPending" and "conflict" both OUTRANK "dirty",
// because the editor's own `dirty` flag stays true underneath both of those
// states (a save that 409s never dispatches "saved", and the Overwrite
// conflict-resolution retry runs its PUT while `conflict` is still true) --
// without this order, either state would get masked back to a plain
// "Unsaved changes" pill mid-flight. `isPending` outranks `conflict` too:
// the Overwrite retry's in-flight PUT is more useful to the operator as
// "Saving…" than as a confusing return to "Conflict" while it's already
// resolving. Returns null for the one state with no pill at all — a
// freshly-loaded, never-edited-or-saved template (dirty=false, savedAt=null)
// — board 4c only defines the four states below.
// eslint-disable-next-line react-refresh/only-export-components -- Pure helper shared with this file's own SaveStatePill AND unit-tested directly (SaveStatePill.test.tsx); not a real Fast Refresh issue for this pattern (same idiom as StaffCard.tsx's formatPrintZonesCaption).
export function computeSaveState({ dirty, isPending, conflict, savedAt }: ComputeSaveStateArgs): SaveState | null {
  if (isPending) return "saving";
  if (conflict) return "conflict";
  if (dirty) return "dirty";
  if (savedAt) return "saved";
  return null;
}

export interface SaveStatePillProps {
  dirty: boolean;
  isPending: boolean;
  conflict: boolean;
  savedAt: string | null;
}

// Codex round (Fix 5): rebuilt on top of @idento/ui's shared StatusPill
// instead of a hand-rolled pill, so the badge editor's save states share the
// exact same visual language (icon+label+color, WCAG 1.4.1) as every other
// status pill in the panel (readiness, attendee check-in, API keys, fonts,
// ...). No @idento/ui changes needed. Status mapping:
//  - saved    -> "ready"       success colors; StatusPill's own default
//                CheckCircle2 icon, unchanged.
//  - saving   -> "empty"       muted colors, per board 4c (NOT "in_progress"
//                — that status's warning colors belong to "dirty" below) +
//                a Loader2 icon override, with `[&_svg]:animate-spin`
//                re-added explicitly via `className` since StatusPill only
//                auto-spins the icon it renders under "in_progress".
//  - dirty    -> "in_progress" warning colors (bg-warning/10 text-warning)
//                match the pre-existing "Unsaved changes" reading exactly +
//                a Pencil icon override — "in_progress"'s own default icon
//                is Loader2 (a spinner), which would visually claim a save
//                is already IN FLIGHT; Pencil reads as "unsaved edits"
//                instead (picked over CircleAlert/AlertCircle specifically
//                because that's the SAME icon "conflict" already uses below
//                — Pencil avoids the collision). StatusPill unconditionally
//                adds `animate-spin` to WHICHEVER icon renders under
//                "in_progress" (packages/ui/src/components/status-pill.tsx),
//                so `[&_svg]:animate-none` is passed via `className` to
//                cancel it — a class+element descendant selector outranks
//                the icon's own single-class `animate-spin` on CSS
//                specificity alone, no @idento/ui change needed (same idiom
//                as BulkBar.tsx's `[&_svg]:size-4` override comment).
//  - conflict -> "error"       destructive colors; StatusPill's own default
//                AlertCircle icon (lucide's "circle-alert"), unchanged.
// `data-state` stays on an outer wrapper `<span>` — not StatusPill's own
// `data-status`, which carries the STATUS name ("in_progress"), not the SAVE
// state ("dirty") — specifically so the pre-existing
// `data-testid="badge-save-state-pill"` + `data-state="..."` test hooks
// throughout BadgeEditorPage.test.tsx keep working untouched.
const STATUS_BY_SAVE_STATE: Record<SaveState, StatusPillStatus> = {
  saved: "ready",
  saving: "empty",
  dirty: "in_progress",
  conflict: "error",
};

export function SaveStatePill({ dirty, isPending, conflict, savedAt }: SaveStatePillProps) {
  const { t, i18n } = useTranslation();
  const state = computeSaveState({ dirty, isPending, conflict, savedAt });
  if (state === null) return null;

  let label: string;
  let icon: LucideIcon | undefined;
  let className: string | undefined;
  switch (state) {
    case "saved": {
      const time = savedAt
        ? new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(savedAt))
        : "";
      label = t("badgeSaved", { time });
      break;
    }
    case "saving":
      label = t("badgeSaving");
      icon = Loader2;
      className = "[&_svg]:animate-spin";
      break;
    case "dirty":
      label = t("badgeUnsaved");
      icon = Pencil;
      className = "[&_svg]:animate-none";
      break;
    case "conflict":
      label = t("badgeConflict");
      break;
  }

  return (
    <span data-testid="badge-save-state-pill" data-state={state}>
      <StatusPill status={STATUS_BY_SAVE_STATE[state]} label={label} icon={icon} className={className} />
    </span>
  );
}
