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
  // Separate from deleteEvent.isError on purpose: onError below closes the
  // dialog in the same tick that it sets this flag, and the reset-on-close
  // effect further down fires right after — if the inline error read
  // deleteEvent.isError directly, that reset would immediately clear it
  // before the user ever saw it (same race ApiKeysCard's revokeError avoids
  // for its own confirm-dialog delete flow).
  const [deleteError, setDeleteError] = React.useState(false);

  const deleteEvent = $api.useMutation("delete", "/api/events/{id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["get", "/api/events"] });
      setDeleteError(false);
      setConfirmOpen(false);
      void navigate({ to: "/" });
    },
    onError: () => {
      // Close the dialog so the inline error below is actually visible (it
      // lives in the card, behind the modal overlay while open) — same
      // convention as ApiKeysCard's revoke flow.
      setDeleteError(true);
      setConfirmOpen(false);
    },
  });

  // Reset the mutation's own pending/error state whenever the dialog
  // transitions closed (P1.1 mutation-reset-on-close rule, re-confirmed
  // through Task 6) — this is about the mutation object itself, not the
  // `deleteError` flag above, which is cleared explicitly when a fresh
  // attempt opens (see the trigger button below).
  React.useEffect(() => {
    if (confirmOpen) return;
    deleteEvent.reset();
    // deleteEvent is a fresh mutation object each render; including it in
    // the deps would reset on every render instead of only on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen]);

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
          {deleteError ? <p className="text-body text-destructive">{t("settingsDeleteError")}</p> : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("settingsDeleteConfirmTitle")}
        description={t("settingsDeleteConfirmBody")}
        confirmLabel={t("settingsDeleteEventConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        typedConfirmation={event.name}
        typedConfirmationLabel={t("settingsDeleteConfirmLabel", { name: event.name })}
        confirmDisabled={deleteEvent.isPending}
        onConfirm={() => deleteEvent.mutate({ params: { path: { id: event.id } } })}
      />
    </>
  );
}
