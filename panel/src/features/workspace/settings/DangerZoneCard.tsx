import {
  Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

export interface DangerZoneCardProps {
  event: ApiEvent;
}

// Board 6a's Danger zone card: red-tinted border, title in text-destructive.
// Only one action row is implemented — "Regenerate all attendee codes" is
// deferred to P2 per reconciliation #8 in the task brief, so this is just
// the delete-event row. Deleting is a real, user-data-destroying action
// (attendees, check-in history, badge design), so it goes through the
// typed-confirmation ConfirmDialog tier keyed on the event's actual name —
// never `window.confirm`, never a bespoke dialog.
export function DangerZoneCard({ event }: DangerZoneCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Whether the last confirmed delete attempt (within the currently open
  // dialog) failed. Shown inside the ConfirmDialog itself via a dynamic
  // `description` — the dialog stays open on failure (see below), so unlike
  // the old auto-close design there's no card-visible-error race to guard
  // against here.
  const [deleteError, setDeleteError] = React.useState(false);
  // Monotonically-incrementing session id, bumped every time the user
  // explicitly closes the confirm dialog (Cancel/Escape/overlay — routed
  // through `handleDialogOpenChange` below). Deliberately NOT bumped when
  // the dialog closes because the delete succeeded (that's a programmatic
  // `setConfirmOpen(false)` in `onSuccess`, which never touches this ref).
  // Same race class + fix as ApiKeysCard's `createSessionRef`: without this,
  // clicking Cancel while a DELETE is in flight doesn't abort the request,
  // and the late-arriving response's onSuccess/onError would still
  // force-navigate or surface an error for a delete the user believed they'd
  // cancelled (the event is still deleted server-side either way — that
  // can't be undone from the client — but the UI must not surprise the user
  // who explicitly backed out). A plain boolean re-armed on every reopen
  // isn't enough to survive a SECOND cancel-then-reopen cycle — see
  // ApiKeysCard's createSessionRef comment for the full failure mode — so
  // this uses the same incrementing-id shape, captured at mutate-time via
  // `onMutate` and compared exactly in `onSuccess`/`onError`.
  const deleteSessionRef = React.useRef(0);

  const deleteEvent = $api.useMutation("delete", "/api/events/{id}", {
    onMutate: () => ({ sessionId: deleteSessionRef.current }),
    onSuccess: (_data, _vars, onMutateResult) => {
      // Invalidation is cache-correctness, not UI reaction: the delete
      // already happened server-side regardless of whether the user
      // "cancelled" the dialog, so this must run unconditionally — only the
      // user-visible reactions below (closing the dialog, navigating) are
      // gated on the session check.
      void queryClient.invalidateQueries({ queryKey: ["get", "/api/events"] });
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setConfirmOpen(false);
      void navigate({ to: "/" });
    },
    onError: (_error, _vars, onMutateResult) => {
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      // Stay open (Fix: typed-confirmation input must survive a transient
      // failure) and show the error inside the dialog via `description`
      // below — not the card, which is hidden behind the modal overlay
      // while the dialog is open.
      setDeleteError(true);
    },
  });

  // Routed to as the ConfirmDialog's `onOpenChange` for every user-driven
  // close path (Cancel button, Escape, overlay click) — a programmatic
  // close from a successful delete calls `setConfirmOpen(false)` directly in
  // `onSuccess` and never reaches this function, so reaching here with
  // `open === false` always means the user explicitly backed out.
  function handleDialogOpenChange(open: boolean) {
    if (!open) {
      // Any response still in flight from this session is now permanently
      // stale — a later reopen gets a new session id, so it can never match
      // again, even across a second cancel-then-reopen cycle.
      deleteSessionRef.current += 1;
      setDeleteError(false);
      // Mutation-reset-on-close (P1.1 rule): only on an explicit user close,
      // not automatically on every close, since a success-driven close never
      // leaves an error to clear.
      deleteEvent.reset();
    }
    setConfirmOpen(open);
  }

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">{t("settingsDanger")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-body font-medium">{t("settingsDeleteEventTitle")}</p>
              <p className="text-caption text-muted-foreground">{t("settingsDeleteEventBody")}</p>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDeleteError(false);
                setConfirmOpen(true);
              }}
            >
              {t("settingsDeleteEventAction")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleDialogOpenChange}
        title={t("settingsDeleteConfirmTitle")}
        description={
          // ConfirmDialog's `description` renders inside Radix's
          // `DialogDescription`, which is itself a `<p>` — block-level
          // elements like `<p>`/`<div>` can't nest inside it (invalid HTML,
          // React DOM-nesting warning), so a second line of text here has to
          // be a `<span className="block">` instead of a `<p>`.
          deleteError ? (
            <>
              {t("settingsDeleteConfirmBody")}
              <span className="mt-1 block text-destructive">{t("settingsDeleteError")}</span>
            </>
          ) : (
            t("settingsDeleteConfirmBody")
          )
        }
        confirmLabel={t("settingsDeleteEventConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        typedConfirmation={event.name}
        typedConfirmationLabel={t("settingsDeleteConfirmLabel", { name: event.name })}
        confirmDisabled={deleteEvent.isPending}
        onConfirm={() => {
          setDeleteError(false);
          deleteEvent.mutate({ params: { path: { id: event.id } } });
        }}
      />
    </>
  );
}
