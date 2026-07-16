import { cn } from "@idento/ui";
import { AlertCircle, AlertTriangle, Check, Loader2, type LucideIcon } from "lucide-react";
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

// Board 4c's save-state pill (Task 10) — purely presentational, no data
// fetching or mutation of its own. BadgeEditorPage.tsx owns all the state
// this reads and passes down as props.
export function SaveStatePill({ dirty, isPending, conflict, savedAt }: SaveStatePillProps) {
  const { t, i18n } = useTranslation();
  const state = computeSaveState({ dirty, isPending, conflict, savedAt });
  if (state === null) return null;

  let icon: LucideIcon;
  let className: string;
  let label: string;
  switch (state) {
    case "saved": {
      const time = savedAt
        ? new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(savedAt))
        : "";
      icon = Check;
      className = "bg-success/10 text-success";
      label = t("badgeSaved", { time });
      break;
    }
    case "saving":
      icon = Loader2;
      className = "bg-muted text-muted-foreground";
      label = t("badgeSaving");
      break;
    case "dirty":
      icon = AlertTriangle;
      className = "bg-warning/10 text-warning";
      label = t("badgeUnsaved");
      break;
    case "conflict":
      icon = AlertCircle;
      className = "bg-destructive/10 text-destructive";
      label = t("badgeConflict");
      break;
  }

  const Icon = icon;
  return (
    <span
      data-testid="badge-save-state-pill"
      data-state={state}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 text-caption font-medium",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", state === "saving" && "animate-spin")} />
      {label}
    </span>
  );
}
