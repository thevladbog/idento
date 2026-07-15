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

type Attendee = components["schemas"]["Attendee"];
type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

// Same narrowing helper as AttendeesPage.tsx's zoneIdentity — useEventZones'
// return type is a union not discriminated by any param this dialog sends.
function zoneIdentity(entry: EventZone | EventZoneWithStats): { id: string; name: string } {
  return "zone" in entry ? { id: entry.zone.id, name: entry.zone.name } : { id: entry.id, name: entry.name };
}

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
  const assignSessionRef = React.useRef(0);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteProgress, setDeleteProgress] = React.useState<Progress | null>(null);
  const [deleteError, setDeleteError] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const deleteSessionRef = React.useRef(0);

  const assignZone = $api.useMutation("post", "/api/attendees/{attendee_id}/zone-access");
  const deleteAttendeeMutation = $api.useMutation("delete", "/api/attendees/{id}");

  function handleAssignOpenChange(open: boolean) {
    if (!open) {
      // Any progress update or invalidation-triggered close still in flight
      // from this session is now permanently stale.
      assignSessionRef.current += 1;
      setAssignProgress(null);
    }
    setAssignOpen(open);
  }

  async function handleAssignZone(zoneId: string) {
    const sessionId = assignSessionRef.current;
    const total = selected.length;
    setAssignProgress({ done: 0, total });
    let attemptedAny = false;
    for (let i = 0; i < selected.length; i++) {
      // The dialog was closed since this batch started — stop issuing
      // further zone-access writes (already-issued ones still land
      // server-side; nothing here can abort an in-flight request).
      if (assignSessionRef.current !== sessionId) break;
      attemptedAny = true;
      try {
        await assignZone.mutateAsync({
          params: { path: { attendee_id: selected[i].id } },
          body: { zone_id: zoneId, allowed: true },
        });
      } catch {
        // Skip individual failures — the batch continues rather than
        // aborting on the first error (per the task brief).
      }
      if (assignSessionRef.current === sessionId) {
        setAssignProgress({ done: i + 1, total });
      }
    }
    if (attemptedAny) {
      // Cache correctness: some requests may have succeeded server-side
      // even if the dialog was closed mid-batch, so this runs
      // unconditionally, unlike the UI reactions below.
      await queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
    }
    // Deliberately does not auto-close on completion: the final "x / x"
    // readout is the honest confirmation that the batch finished (some
    // items may have been skipped on failure), so the user closes it
    // themselves once they've seen it.
  }

  function handleDeleteOpenChange(open: boolean) {
    if (!open) {
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
          <button
            type="button"
            className="text-caption text-background/70 hover:text-background"
            onClick={() => setAssignOpen(true)}
          >
            {t("bulkAssignZone")}
          </button>
          {/* Deliberately locked: not a button, no click handler — the
              badge editor this depends on doesn't exist yet. */}
          <span className="cursor-default select-none text-caption text-background/40">
            {t("bulkPrintLocked")}
          </span>
          <button
            type="button"
            className="text-caption text-background/70 hover:text-background"
            onClick={() => exportAttendeesCsv(selected)}
          >
            {t("bulkExport")}
          </button>
          <button
            type="button"
            className="text-caption text-destructive hover:opacity-80"
            onClick={() => setDeleteOpen(true)}
          >
            {t("bulkDelete")}
          </button>
        </div>
        <button
          type="button"
          className="ml-auto text-caption text-background/50 hover:text-background"
          onClick={onClear}
        >
          {t("bulkClear")}
        </button>
      </div>

      <Dialog open={assignOpen} onOpenChange={handleAssignOpenChange}>
        <DialogContent closeLabel={t("workspaceDialogClose")}>
          <DialogHeader>
            <DialogTitle>{t("bulkAssignZone")}</DialogTitle>
          </DialogHeader>
          {assignProgress ? (
            <p className="text-body text-muted-foreground">
              {t("bulkAssignZoneProgress", { done: assignProgress.done, total: assignProgress.total })}
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
