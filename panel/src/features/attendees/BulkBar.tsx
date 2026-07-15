import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { exportAttendeesCsv } from "./exportCsv";
import { ATTENDEES_LIST_KEY, useEventZones } from "./hooks";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

type Attendee = components["schemas"]["Attendee"];

export interface BulkBarProps {
  selected: Attendee[];
  eventId: string;
  onClear: () => void;
}

interface Progress {
  done: number;
  total: number;
}

// Board 1g's bulk-select bar: dark inline bar (bg-foreground/text-background
// — the codebase's existing dark-inversion utility, e.g. AttendeeTable's
// active pager pill, not a raw hex), rounded, NOT sticky. Assign zone and
// Delete… both fire one request per selected attendee SEQUENTIALLY (not
// Promise.all) with a live progress readout, since the board's copy is an
// honest "x / y" count, not a fabricated spinner. Both use the same
// cancel-during-pending session-id-ref pattern as ApiKeysCard/
// DangerZoneCard: an incrementing ref bumped on every explicit dialog close
// stops stray UI reactions from a request that resolves after the user
// backed out, while cache invalidation for whatever already succeeded
// server-side still runs unconditionally.
export function BulkBar({ selected, eventId, onClear }: BulkBarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const zonesQuery = useEventZones(eventId);

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignProgress, setAssignProgress] = React.useState<Progress | null>(null);
  // Task 13/ImportWizard-style honesty fix: how many of the ATTEMPTED
  // zone-access writes in the current/last batch failed — tracked
  // separately from `assignProgress.done` (which counts attempts, not
  // successes), so the completion readout can distinguish "50 / 50 attempted"
  // from "50 attempted, 2 of them failed" instead of implying full success.
  const [assignFailedCount, setAssignFailedCount] = React.useState(0);
  // True only while handleAssignZone's sequential loop is genuinely
  // in-flight (distinct from assignSessionRef/assignProgress, which track
  // "is this session stale", not "is the loop currently running") — gates
  // the assign dialog's dismissal below so a user can't silently abandon a
  // batch partway through with no indication which attendees were skipped.
  const [isAssigning, setIsAssigning] = React.useState(false);
  const assignSessionRef = React.useRef(0);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteProgress, setDeleteProgress] = React.useState<Progress | null>(null);
  const [deleteError, setDeleteError] = React.useState(false);
  // Already tracked "the sequential delete loop is genuinely running" before
  // this fix (used for confirmDisabled) — reused as-is for the new
  // dismissal-gating below rather than adding a redundant second flag.
  const [deleting, setDeleting] = React.useState(false);
  const deleteSessionRef = React.useRef(0);

  const assignZone = $api.useMutation("post", "/api/attendees/{attendee_id}/zone-access");
  const deleteAttendeeMutation = $api.useMutation("delete", "/api/attendees/{id}");

  function handleAssignOpenChange(open: boolean) {
    if (!open) {
      // Genuinely still running: ignore the close request outright (X,
      // Escape, and outside-click all route through this same
      // onOpenChange — see dialog.tsx/Radix's Close/DismissableLayer, which
      // both call the single `onOpenChange` prop). Silently abandoning a
      // batch mid-way would leave an unknown number of the remaining
      // attendees never assigned, with no record of which ones.
      if (isAssigning) return;
      // Any progress update or invalidation-triggered close still in flight
      // from this session is now permanently stale.
      assignSessionRef.current += 1;
      setAssignProgress(null);
      setAssignFailedCount(0);
    }
    setAssignOpen(open);
  }

  async function handleAssignZone(zoneId: string) {
    const sessionId = assignSessionRef.current;
    const total = selected.length;
    setIsAssigning(true);
    setAssignProgress({ done: 0, total });
    setAssignFailedCount(0);
    let attemptedAny = false;
    let failedCount = 0;
    for (let i = 0; i < selected.length; i++) {
      // The dialog was closed since this batch started — stop issuing
      // further zone-access writes (already-issued ones still land
      // server-side; nothing here can abort an in-flight request). In
      // practice this is now unreachable via the UI while isAssigning is
      // true (handleAssignOpenChange blocks the close), but it's kept as
      // defense-in-depth for any path that still flips the session.
      if (assignSessionRef.current !== sessionId) break;
      attemptedAny = true;
      try {
        await assignZone.mutateAsync({
          params: { path: { attendee_id: selected[i].id } },
          body: { zone_id: zoneId, allowed: true },
        });
      } catch {
        // Individual failures don't abort the batch (per the task brief) —
        // but they ARE counted now, so the completion readout can be
        // honest about them instead of implying full success.
        failedCount += 1;
      }
      if (assignSessionRef.current === sessionId) {
        setAssignProgress({ done: i + 1, total });
        setAssignFailedCount(failedCount);
      }
    }
    if (attemptedAny) {
      // Cache correctness: some requests may have succeeded server-side
      // even if the dialog was closed mid-batch, so this runs
      // unconditionally, unlike the UI reactions below.
      await queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
    }
    setIsAssigning(false);
    // Deliberately does not auto-close on completion: the final "x / x"
    // readout (now honest about failures too) is the confirmation the user
    // reads before closing it themselves.
  }

  function handleDeleteOpenChange(open: boolean) {
    if (!open) {
      // Same "genuinely still running" gate as handleAssignOpenChange
      // above — a batch delete must not be silently abandonable mid-way
      // either (some attendees would be deleted, some not, with no record
      // of which).
      if (deleting) return;
      deleteSessionRef.current += 1;
      setDeleteError(false);
      setDeleteProgress(null);
      setDeleting(false);
      // Mutation-reset-on-close: the shared mutation object is reused
      // across every DELETE in the batch, so a stale error/pending flag
      // from a previous run must not leak into the next open.
      deleteAttendeeMutation.reset();
    }
    setDeleteOpen(open);
  }

  async function handleConfirmDelete() {
    const sessionId = deleteSessionRef.current;
    setDeleteError(false);
    setDeleting(true);
    const total = selected.length;
    setDeleteProgress({ done: 0, total });
    let hadFailure = false;
    let attemptedAny = false;
    for (let i = 0; i < selected.length; i++) {
      // Unreachable via the UI while `deleting` is true (see
      // handleDeleteOpenChange above) — kept as defense-in-depth.
      if (deleteSessionRef.current !== sessionId) break;
      attemptedAny = true;
      try {
        await deleteAttendeeMutation.mutateAsync({ params: { path: { id: selected[i].id } } });
      } catch {
        hadFailure = true;
      }
      if (deleteSessionRef.current === sessionId) {
        setDeleteProgress({ done: i + 1, total });
      }
    }
    if (attemptedAny) {
      await queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
    }
    if (deleteSessionRef.current !== sessionId) return;
    setDeleting(false);
    if (hadFailure) {
      // Stay open (typed-confirm dialogs must survive a transient failure
      // rather than forcing the user to retype the count) and show the
      // error inline via `description` below.
      setDeleteError(true);
    } else {
      setDeleteOpen(false);
    }
  }

  const zones = (zonesQuery.data ?? []).map(zoneIdentity);
  const count = selected.length;

  return (
    <>
      <div className="flex items-center gap-3 rounded-[9px] bg-foreground px-3.5 py-2.5 text-background shadow-sm">
        <span className="text-body">{t("bulkSelected", { count })}</span>
        <span className="h-4 w-px bg-background/30" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-caption text-background/70 hover:text-background hover:no-underline"
            onClick={() => setAssignOpen(true)}
          >
            {t("bulkAssignZone")}
          </Button>
          {/* Deliberately locked: not a button, no click handler — the
              badge editor this depends on doesn't exist yet. */}
          <span className="cursor-default select-none text-caption text-background/40">
            {t("bulkPrintLocked")}
          </span>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-caption text-background/70 hover:text-background hover:no-underline"
            onClick={() => exportAttendeesCsv(selected)}
          >
            {t("bulkExport")}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-caption text-destructive hover:opacity-80 hover:no-underline"
            onClick={() => setDeleteOpen(true)}
          >
            {t("bulkDelete")}
          </Button>
        </div>
        <Button
          type="button"
          variant="link"
          className="ml-auto h-auto p-0 text-caption text-background/50 hover:text-background hover:no-underline"
          onClick={onClear}
        >
          {t("bulkClear")}
        </Button>
      </div>

      <Dialog open={assignOpen} onOpenChange={handleAssignOpenChange}>
        <DialogContent
          closeLabel={t("workspaceDialogClose")}
          hideClose={isAssigning}
          onEscapeKeyDown={(e) => {
            if (isAssigning) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isAssigning) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isAssigning) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("bulkAssignZone")}</DialogTitle>
          </DialogHeader>
          {assignProgress ? (
            <p className="text-body text-muted-foreground">
              {/* Once the batch has settled (no longer isAssigning) with at
                  least one failure, the readout switches from the plain "x /
                  y" attempted-count to an honest success/failure breakdown —
                  see assignFailedCount's doc comment above. Scope note: this
                  is a message-honesty fix only; it deliberately does NOT add
                  a per-row retry affordance for the failed assignments (a
                  bigger feature, out of budget here). */}
              {!isAssigning && assignFailedCount > 0
                ? t("bulkAssignZoneDoneWithFailures", {
                    succeeded: assignProgress.total - assignFailedCount,
                    total: assignProgress.total,
                    failed: assignFailedCount,
                  })
                : t("bulkAssignZoneProgress", { done: assignProgress.done, total: assignProgress.total })}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {zones.map((zone) => (
                <Button key={zone.id} type="button" variant="outline" onClick={() => void handleAssignZone(zone.id)}>
                  {zone.name}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        title={t("bulkDeleteConfirmTitle", { count })}
        description={
          deleting && deleteProgress ? (
            <>
              {t("bulkDeleteConfirmBody")}
              <span className="mt-1 block">
                {t("bulkDeleteProgress", { done: deleteProgress.done, total: deleteProgress.total })}
              </span>
            </>
          ) : deleteError ? (
            <>
              {t("bulkDeleteConfirmBody")}
              <span className="mt-1 block text-destructive">{t("bulkDeleteError")}</span>
            </>
          ) : (
            t("bulkDeleteConfirmBody")
          )
        }
        confirmLabel={t("bulkDelete")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        typedConfirmation={String(count)}
        typedConfirmationLabel={t("bulkDeleteConfirmLabel", { count })}
        confirmDisabled={deleting}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  );
}
