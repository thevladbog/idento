import {
  Avatar, AvatarFallback, Button, Card, ConfirmDialog, Skeleton,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { QrPrintCard } from "./QrPrintSheet";
import { QrSvg } from "./QrSvg";
import { StaffZonesDialog } from "./StaffZonesDialog";
import { STAFF_KEY } from "./hooks";
import type { StaffUser } from "./hooks";
import { $api } from "../../shared/api/query";

export interface StaffCardProps {
  user: StaffUser;
  // Resolved by the caller (StaffPage's per-row wrapper, which joins
  // useUserZoneAssignments(user.id) against the event's plain zones list) —
  // this component is purely presentational and never fetches anything
  // itself. "loading"/"error" are distinct terminal states, never collapsed
  // into an empty array (P2.1 honesty rule: an error must never render as
  // "no zones").
  zoneNames: string[] | "loading" | "error";
  // Needed for the Zones/Revoke actions this card owns internally (the
  // StaffZonesDialog it mounts, and the DELETE .../staff/{user_id} revoke
  // call below) — both are event-scoped, unlike everything else on this
  // card (which is keyed purely by user.id).
  eventId: string;
  // Mirrors StaffPage's header gating (the caller's role in the active
  // tenant, fetched live — see StaffPage.tsx): printing/generating a QR
  // card is admin-only (reconciliation #11/15). Zones/Revoke are available
  // to admin OR manager — gated by `canManage` alone below. NOTE
  // (reconciliation #15 gate-check): the backend's own
  // AssignStaffToZone/RemoveStaffFromZone handlers (backend/internal/
  // handler/zones.go) carry NO role check at all — only requireZoneOwnership
  // (tenant scope), unlike AssignStaffToEvent/UnassignStaffFromEvent/
  // GetUsers/CreateUser, which all explicitly reject non-admin/manager
  // callers server-side. This `canManage` gate is therefore UI-only
  // enforcement for the Zones action specifically — a plain "staff" caller
  // who forged a direct request could still call those two zone endpoints
  // successfully. Documented, not fixed: the backend is out of scope here.
  isAdmin: boolean;
  canManage: boolean;
  // Session-scoped QR token cache, owned and passed down by StaffPage
  // (`React.useState<Map<string, string>>`, never persisted — see
  // StaffPage.tsx's own doc comment on why). `undefined` means this user's
  // token was never generated THIS session — note `user.has_qr_token` can
  // still be true in that case: the raw token string is only ever readable
  // once, exactly when POST .../qr-token responds, never from the staff
  // list itself.
  cachedToken: string | undefined;
  // Reports a freshly (re)generated token up to StaffPage's shared cache.
  // Called UNCONDITIONALLY on a successful generate/regenerate — even if
  // the regenerate confirm dialog was closed mid-flight (see the
  // session-ref guard below) — because the token IS valid server-side
  // regardless of what this card's own UI does next; StaffPage's
  // implementation also invalidates STAFF_KEY unconditionally here.
  onTokenCached: (userId: string, token: string) => void;
  // Opens StaffPage's single shared print sheet with this one card. Never
  // rendered by StaffCard itself — only one #qr-print-root portal may exist
  // at a time, and StaffPage reuses the same one for "Print all".
  onOpenPrintSheet: (card: QrPrintCard) => void;
  // True while a page-level bulk operation ("Print all") is running — keeps
  // this card's Generate/Print controls inert for its duration (exhaustive
  // busy-gating), on top of the admin-only gating below.
  disabled: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared role-label lookup belongs with the card that owns it; StaffPage's "Print all" loop reuses it too (see StaffPage.tsx). Not a real Fast Refresh issue for this pattern.
export const ROLE_LABEL_KEYS: Record<StaffUser["role"], string> = {
  admin: "staffRoleAdmin",
  manager: "staffRoleManager",
  staff: "staffRoleStaff",
};

// First two characters of the email's local part (before "@"), uppercased —
// there is no name field on User to derive real initials from.
function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

// The flat zones-caption STRING — reused verbatim (not a separate i18n key)
// for the QR card visual's caption and for print cards, per the task brief
// ("caption `staffQrCaption` ... reusing the zones caption"). Exported so
// StaffPage's "Print all" loop can build the same caption for staff members
// whose own card isn't necessarily mounted/visible at that moment.
// "loading" has no honest text to show (an in-flight fetch isn't "no
// zones") — reaching this while zones are still loading is an edge case
// (Print/Generate could technically be clicked before the per-card zones
// fetch resolves), so it's blank rather than fabricated.
// eslint-disable-next-line react-refresh/only-export-components -- Pure helper shared with StaffPage's "Print all" loop; not a real Fast Refresh issue for this pattern.
export function formatZonesCaption(t: TFunction, zoneNames: string[] | "loading" | "error"): string {
  if (zoneNames === "loading") return "";
  if (zoneNames === "error") return t("staffZonesError");
  if (zoneNames.length === 0) return t("staffZonesNone");
  return t("staffZonesCaption", { zones: zoneNames.join(", ") });
}

// Local-time display (deliberately NOT UTC-pinned, unlike every other
// timestamp in this codebase — e.g. eventDates.ts/AttendeeDrawer.tsx pin UTC
// because THEIR source values are bare calendar dates / server-recorded
// instants a viewer's timezone must not shift). `qr_token_created_at` is a
// real "when did this actually happen, in front of this viewer" moment, so
// the viewer's own local time is the honest reading (task brief, verbatim).
function formatIssuedAt(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function StaffCard({
  user, zoneNames, eventId, isAdmin, canManage, cachedToken, onTokenCached, onOpenPrintSheet, disabled,
}: StaffCardProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [zonesOpen, setZonesOpen] = React.useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = React.useState(false);
  // Same non-blocking, session-ref-guarded pattern as the regenerate confirm
  // below: revoke is a single fire-and-forget destructive action once
  // confirmed, so backing out mid-flight just means "don't act on the
  // response when it lands" — invalidation still runs unconditionally.
  const revokeSessionRef = React.useRef(0);
  const revokeStaff = $api.useMutation("delete", "/api/events/{event_id}/staff/{user_id}", {
    onMutate: () => ({ sessionId: revokeSessionRef.current }),
  });
  // Bumped whenever the regenerate confirm dialog closes (Cancel/X/Escape/
  // outside-click all route through handleConfirmOpenChange below, since
  // that's the single onOpenChange Radix's Dialog calls for every dismiss
  // path). Unlike AddAttendeeDialog's equivalent ref, closing here is NOT
  // blocked while the mutation is pending: a regenerate is a single
  // fire-and-forget action once confirmed (there's no in-progress form data
  // to protect), so the user backing out just means "don't act on the
  // response when it lands" — the cache update/invalidation still happen
  // regardless (see runGenerate below), only the confirm-dialog-close +
  // print-sheet-open are gated on the session still matching.
  const sessionRef = React.useRef(0);

  const generateToken = $api.useMutation("post", "/api/users/{id}/qr-token", {
    onMutate: () => ({ sessionId: sessionRef.current }),
  });

  const roleLabel = t(ROLE_LABEL_KEYS[user.role]);
  const zonesCaption = formatZonesCaption(t, zoneNames);

  function buildPrintCard(token: string): QrPrintCard {
    return {
      email: user.email, roleLabel, zonesCaption, token,
    };
  }

  function runGenerate(openSheetAfter: boolean) {
    generateToken.mutate(
      { params: { path: { id: user.id } } },
      {
        onSuccess: (data, _vars, onMutateResult) => {
          // Cache/invalidation correctness: the token IS issued server-side
          // now regardless of what this card's own dialog does next, so
          // this runs unconditionally — only the dialog-close/sheet-open
          // below are gated on the session still matching.
          onTokenCached(user.id, data.qr_token);
          if (onMutateResult?.sessionId !== sessionRef.current) return;
          setConfirmOpen(false);
          if (openSheetAfter) onOpenPrintSheet(buildPrintCard(data.qr_token));
        },
      },
    );
  }

  // The dashed "no QR yet" box's own affordance — issues a code and shows it
  // live on the card (state flips to "cached"). Deliberately does NOT jump
  // to the print sheet, unlike handlePrintClick's equivalent branch below:
  // this is "get a code onto the record", not "print right now".
  function handleGenerateClick() {
    runGenerate(false);
  }

  function handlePrintClick() {
    if (cachedToken) {
      onOpenPrintSheet(buildPrintCard(cachedToken));
      return;
    }
    if (user.has_qr_token) {
      // Reconciliation #11: an already-issued-but-uncached token can only
      // be printed by regenerating it (the raw string is unrecoverable) —
      // that invalidates whatever card was printed before, so it's a
      // tier-1 confirm.
      setConfirmOpen(true);
      return;
    }
    // Never issued before — nothing to invalidate yet, no confirm needed.
    runGenerate(true);
  }

  function handleConfirmOpenChange(open: boolean) {
    if (!open) {
      sessionRef.current += 1;
      // NOT called unconditionally: `.reset()` detaches this mutation
      // observer from the in-flight `Mutation` (TanStack Query internals —
      // `MutationObserver#reset` calls `removeObserver`), which would
      // permanently silence the per-call `onSuccess` below once the
      // response lands — breaking the "cache/invalidate unconditionally"
      // guarantee this component relies on for the cancel race. Only reset
      // (to clear a stale error before the next open) once nothing is
      // actually in flight.
      if (!generateToken.isPending) generateToken.reset();
    }
    setConfirmOpen(open);
  }

  function handleRevokeConfirmOpenChange(open: boolean) {
    if (!open) {
      revokeSessionRef.current += 1;
      // Same "don't detach an in-flight observer" nuance as
      // handleConfirmOpenChange above.
      if (!revokeStaff.isPending) revokeStaff.reset();
    }
    setRevokeConfirmOpen(open);
  }

  function handleConfirmRevoke() {
    revokeStaff.mutate(
      { params: { path: { event_id: eventId, user_id: user.id } } },
      {
        onSuccess: (_data, _vars, onMutateResult) => {
          // The assignment WAS removed server-side regardless of session —
          // invalidate unconditionally. Deliberately does NOT touch
          // USER_ZONES_KEY(user.id): revoking event-day staff access doesn't
          // change this user's zone assignments, and refetching that query
          // for a row that's about to disappear from the list would just be
          // error noise, not a real cache-correctness need.
          void queryClient.invalidateQueries({ queryKey: STAFF_KEY(eventId) });
          if (onMutateResult?.sessionId !== revokeSessionRef.current) return;
          setRevokeConfirmOpen(false);
        },
      },
    );
  }

  // Reconciliation #11/15 + the task brief: generate/print are admin-only,
  // regardless of `canManage` (a manager can see this card's QR area but
  // never act on it). Combined with the page-level "Print all" busy flag
  // (exhaustive busy-gating) and this card's own mutation pending state.
  const controlsDisabled = !isAdmin || disabled || generateToken.isPending;
  const controlsTitle = !isAdmin ? t("staffAdminOnly") : undefined;

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center gap-2.5">
        <Avatar className="size-[30px]">
          <AvatarFallback className="bg-success/10 text-caption font-semibold text-success">
            {emailInitials(user.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="text-body font-bold">{user.email}</span>
          <span className="text-caption text-muted-foreground">{roleLabel}</span>
        </div>
      </div>

      {zoneNames === "loading" ? (
        <Skeleton className="h-4 w-40" data-testid="staff-zones-skeleton" />
      ) : zoneNames === "error" ? (
        <span className="text-caption text-destructive">{zonesCaption}</span>
      ) : zoneNames.length === 0 ? (
        <span className="text-caption text-muted-foreground">{zonesCaption}</span>
      ) : (
        <span className="font-mono text-caption text-muted-foreground">{zonesCaption}</span>
      )}

      {/* QR card visual — three mutually exclusive states per the task
          brief, keyed off the session-only cache first (it's the only place
          the raw token string is ever readable) and `has_qr_token` second. */}
      {cachedToken ? (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <QrSvg
            value={cachedToken}
            label={t("staffQrPrintLabel", { email: user.email })}
            className="size-14 shrink-0"
          />
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-caption text-muted-foreground">{zonesCaption}</span>
            {user.qr_token_created_at ? (
              <span className="text-caption text-muted-foreground">
                {t("staffQrIssued", { date: formatIssuedAt(user.qr_token_created_at, i18n.language) })}
              </span>
            ) : null}
          </div>
        </div>
      ) : user.has_qr_token ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-caption text-muted-foreground">
          {t("staffQrNotShown", {
            date: user.qr_token_created_at ? formatIssuedAt(user.qr_token_created_at, i18n.language) : "",
          })}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
          <span className="text-caption text-muted-foreground">{t("staffQrNone")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={controlsDisabled}
            title={controlsTitle}
            onClick={handleGenerateClick}
          >
            {t("staffQrGenerate")}
          </Button>
        </div>
      )}

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="link"
            disabled={controlsDisabled}
            title={controlsTitle}
            onClick={handlePrintClick}
            className="h-auto p-0 text-caption text-success hover:no-underline"
          >
            {t("staffActionPrint")}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => setZonesOpen(true)}
            className="h-auto p-0 text-caption text-muted-foreground hover:no-underline"
          >
            {t("staffActionZones")}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => setRevokeConfirmOpen(true)}
            className="ml-auto h-auto p-0 text-caption text-destructive hover:no-underline"
          >
            {t("staffActionRevoke")}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        title={t("staffRegenerateConfirmTitle")}
        description={
          generateToken.isError ? (
            <>
              {t("staffRegenerateConfirmBody")}
              <span className="mt-1 block text-destructive">{t("staffRegenerateError")}</span>
            </>
          ) : (
            t("staffRegenerateConfirmBody")
          )
        }
        confirmLabel={t("staffActionPrint")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        confirmDisabled={generateToken.isPending}
        onConfirm={() => runGenerate(true)}
      />

      {canManage ? <StaffZonesDialog user={user} eventId={eventId} open={zonesOpen} onOpenChange={setZonesOpen} /> : null}

      <ConfirmDialog
        open={revokeConfirmOpen}
        onOpenChange={handleRevokeConfirmOpenChange}
        title={t("staffRevokeConfirmTitle")}
        description={
          revokeStaff.isError ? (
            <>
              {t("staffRevokeConfirmBody", { email: user.email })}
              <span className="mt-1 block text-destructive">{t("staffRevokeError")}</span>
            </>
          ) : (
            t("staffRevokeConfirmBody", { email: user.email })
          )
        }
        confirmLabel={t("staffRevokeConfirmAction")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={revokeStaff.isPending}
        onConfirm={handleConfirmRevoke}
      />
    </Card>
  );
}
