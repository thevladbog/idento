import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label, Switch,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { USER_ZONES_KEY, useUserZoneAssignments } from "./hooks";
import type { StaffUser } from "./hooks";
import { $api } from "../../shared/api/query";
import { useEventZones } from "../attendees/hooks";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

export interface StaffZonesDialogProps {
  user: StaffUser;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Per-zone scope editor: one Switch per event zone, checked exactly when an
// assignment row exists for this user. Deliberately has NO optimistic local
// "checked" override — the Switch's `checked` is always derived straight
// from `useUserZoneAssignments` (server truth), so a click doesn't visually
// flip until the request has actually settled and the query has
// refetched. That's what makes "failure reverts" true for free: nothing was
// ever shown as changed until the server confirmed it, so a rejected toggle
// simply never moves — the only extra step is surfacing `staffZonesToggleError`
// so the attempt itself isn't silently swallowed (the exact P2.1 "silent
// failure" bug class this task calls out).
export function StaffZonesDialog({
  user, eventId, open, onOpenChange,
}: StaffZonesDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const zonesQuery = useEventZones(eventId);
  const assignmentsQuery = useUserZoneAssignments(user.id);

  // Per-ROW pending/error state — a `Set`/`Set`, never the shared
  // mutation's own `.isPending`/`.variables` (P2.1 lesson: those reflect
  // only the LAST call across every row sharing the same mutation object,
  // which is exactly wrong once two rows can be in flight at once).
  const [pendingZoneIds, setPendingZoneIds] = React.useState<Set<string>>(new Set());
  const [errorZoneIds, setErrorZoneIds] = React.useState<Set<string>>(new Set());

  const assignMutation = $api.useMutation("post", "/api/zones/{zone_id}/staff");
  const removeMutation = $api.useMutation("delete", "/api/zones/{zone_id}/staff/{user_id}");

  const anyPending = pendingZoneIds.size > 0;

  // Dismissal (Close button, X, Escape, outside-click) is blocked ONLY
  // while at least one toggle is genuinely in flight — an exhaustive gate,
  // not scoped to whichever row was clicked last.
  function handleOpenChange(next: boolean) {
    if (!next && anyPending) return;
    onOpenChange(next);
  }

  function preventDialogDismiss(e: Event) {
    if (anyPending) e.preventDefault();
  }

  async function handleToggle(zoneId: string, nextChecked: boolean) {
    setPendingZoneIds((prev) => new Set(prev).add(zoneId));
    setErrorZoneIds((prev) => {
      if (!prev.has(zoneId)) return prev;
      const next = new Set(prev);
      next.delete(zoneId);
      return next;
    });
    try {
      if (nextChecked) {
        // ON CONFLICT DO NOTHING server-side (idempotent) — the response's
        // id/assigned_at are NOT trusted here even on a fresh assignment;
        // the query invalidation below is what the checked state actually
        // reflects, never this response body directly.
        await assignMutation.mutateAsync({ params: { path: { zone_id: zoneId } }, body: { user_id: user.id } });
      } else {
        // DELETE needs only the assignment row's zone_id (+ this user's
        // id) as path params — idempotent, no request body.
        await removeMutation.mutateAsync({ params: { path: { zone_id: zoneId, user_id: user.id } } });
      }
    } catch {
      setErrorZoneIds((prev) => new Set(prev).add(zoneId));
    } finally {
      setPendingZoneIds((prev) => {
        const next = new Set(prev);
        next.delete(zoneId);
        return next;
      });
      // Unconditional on both success AND failure — the query is the only
      // source of truth for `checked`, so it must be refreshed regardless
      // of which way this attempt went.
      void queryClient.invalidateQueries({ queryKey: USER_ZONES_KEY(user.id) });
    }
  }

  const zones = (zonesQuery.data ?? []).map(zoneIdentity);
  const assignedZoneIds = new Set((assignmentsQuery.data ?? []).map((a) => a.zone_id));
  const isLoading = zonesQuery.isLoading || assignmentsQuery.isLoading;
  const isError = zonesQuery.isError || assignmentsQuery.isError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        hideClose={anyPending}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader>
          <DialogTitle>{t("staffZonesDialogTitle", { email: user.email })}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-body text-muted-foreground">{t("staffZonesDialogLoading")}</p>
        ) : isError ? (
          <p className="text-body text-destructive">{t("staffZonesDialogLoadError")}</p>
        ) : zones.length === 0 ? (
          <p className="text-body text-muted-foreground">{t("staffZonesDialogEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {zones.map((zone) => {
              const switchId = `staff-zone-switch-${zone.id}`;
              const pending = pendingZoneIds.has(zone.id);
              const hasError = errorZoneIds.has(zone.id);
              return (
                <div key={zone.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={switchId}>{zone.name}</Label>
                    <Switch
                      id={switchId}
                      checked={assignedZoneIds.has(zone.id)}
                      disabled={pending}
                      onCheckedChange={(next) => void handleToggle(zone.id, next)}
                    />
                  </div>
                  {hasError ? <p className="text-caption text-destructive">{t("staffZonesToggleError")}</p> : null}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-caption text-muted-foreground">{t("staffZonesDialogHint")}</p>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={anyPending} onClick={() => handleOpenChange(false)}>
            {t("workspaceDialogClose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
