import {
  Avatar, AvatarFallback, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Label,
  Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, StatusPill,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { EditAttendeeForm } from "./EditAttendeeForm";
import {
  ATTENDEES_LIST_KEY, ATTENDEE_DETAIL_KEY, ATTENDEE_ZONE_ACCESS_KEY, useAttendeeDetail, useAttendeeZoneAccess,
  useAttendeeZoneHistory, useEventZones,
} from "./hooks";
import { READINESS_KEY } from "../events/hooks";
import { MarkPrintedError, MissingFontError, NoTemplateError, usePrintBadge } from "../badge/zpl/usePrintBadge";
import { AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import { zoneIdentity, type ZoneListEntry } from "../../shared/lib/zoneIdentity";

type Attendee = components["schemas"]["Attendee"];
type AttendeeZoneAccess = components["schemas"]["AttendeeZoneAccess"];
type MovementHistoryEntry = components["schemas"]["MovementHistoryEntry"];

const RECENT_ACTIVITY_LIMIT = 3;

// Native <select>, styled to match PropertiesPane.tsx's/TestPrintDialog.tsx's
// own SELECT_CLASSNAME (duplicated per-file on purpose -- see those files'
// own comments: there's no shared @idento/ui Select primitive yet).
const REPRINT_SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Board 3e / task brief: times are rendered "HH:MM" pinned to UTC (same
// rationale as EventRow.tsx/eventDates.ts — a viewer's local timezone must
// not shift a server-recorded check-in time). Hand-rolled rather than
// Intl.DateTimeFormat so the 24h zero-padded "HH:MM" shape is guaranteed
// identical in both locales instead of depending on locale formatting
// conventions.
function formatUtcHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase();
}

export interface AttendeeDrawerProps {
  eventId: string;
  attendeeId: string;
  onClose: () => void;
}

// Board 3e (the drawer winner over the 3d full page — see
// p2-board-3e-6b-6c-extract.md §2). Task 8 built the shell and every
// read-only section; this task (P2.1 Task 9) wires the action row's "Edit
// details" button, the zone chip picker's "+ Zone" affordance, and the
// footer's "Regenerate code…"/"Delete…" confirm flows.
export function AttendeeDrawer({ eventId, attendeeId, onClose }: AttendeeDrawerProps) {
  const { t } = useTranslation();
  const attendeeQuery = useAttendeeDetail(attendeeId);
  const zoneAccessQuery = useAttendeeZoneAccess(attendeeId);
  const zoneHistoryQuery = useAttendeeZoneHistory(attendeeId);
  const zonesQuery = useEventZones(eventId);
  // Bridges EditAttendeeForm's PATCH-pending state (surfaced via DrawerBody's
  // `onEditBusyChange` prop) up to this Sheet's `onOpenChange` without
  // needing a re-render here: the flag is only ever CONSULTED at the moment
  // the user tries to dismiss the Sheet (Escape/outside-click), never
  // rendered, so a ref bridge is enough — DrawerBody is a plain function
  // component (not a context provider), and lifting this into real state
  // would force it to re-render on every keystroke's pending-state churn for
  // no visible benefit.
  const isEditBusyRef = React.useRef(false);
  const handleEditBusyChange = React.useCallback((busy: boolean) => {
    isEditBusyRef.current = busy;
  }, []);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        // While EditAttendeeForm's PATCH is genuinely in flight, Escape/
        // outside-click must not unmount the whole drawer out from under it
        // — the regenerate/delete ConfirmDialogs don't need this guard since
        // Radix's nested dialog stacking already intercepts Escape/
        // outside-click before it reaches this outer Sheet.
        if (!open && isEditBusyRef.current) return;
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" closeLabel={t("workspaceDialogClose")} className="w-[400px] max-w-[400px]">
        {/* Always-present, visually-hidden accessible title — decoupled
            from the visible bold attendee name (rendered inside the loaded
            body below) so the dialog has a valid accessible name in every
            state (loading/error/loaded), not just once data has arrived. */}
        <SheetHeader className="sr-only">
          <SheetTitle>{t("drawerTitleFallback")}</SheetTitle>
        </SheetHeader>

        {attendeeQuery.isLoading ? (
          <DrawerSkeleton />
        ) : attendeeQuery.isError || !attendeeQuery.data ? (
          <p className="text-body text-destructive">{t("drawerLoadError")}</p>
        ) : (
          // Keyed by attendee id: if the caller ever swaps to a different
          // attendee while the drawer stays mounted (e.g. clicking another
          // row without closing first), this remounts DrawerBody from
          // scratch — resetting edit mode, in-flight mutation session refs,
          // and any dialog state — rather than carrying stale UI state
          // (edit form open, a pending regenerate confirm, etc.) over to a
          // completely different attendee's data.
          <DrawerBody
            key={attendeeQuery.data.id}
            eventId={eventId}
            attendee={attendeeQuery.data}
            zoneAccess={zoneAccessQuery.data}
            zoneAccessLoading={zoneAccessQuery.isLoading}
            zoneAccessError={zoneAccessQuery.isError}
            zoneHistory={zoneHistoryQuery.data}
            zoneHistoryLoading={zoneHistoryQuery.isLoading}
            zoneHistoryError={zoneHistoryQuery.isError}
            zones={zonesQuery.data}
            zonesLoading={zonesQuery.isLoading}
            onClose={onClose}
            onEditBusyChange={handleEditBusyChange}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerSkeleton() {
  return (
    <div data-testid="attendee-drawer-skeleton" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-6 w-44 rounded-full" />
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}

interface DrawerBodyProps {
  eventId: string;
  attendee: Attendee;
  zoneAccess: AttendeeZoneAccess[] | undefined;
  zoneAccessLoading: boolean;
  zoneAccessError: boolean;
  zoneHistory: MovementHistoryEntry[] | undefined;
  zoneHistoryLoading: boolean;
  zoneHistoryError: boolean;
  zones: ZoneListEntry[] | undefined;
  zonesLoading: boolean;
  onClose: () => void;
  onEditBusyChange: (busy: boolean) => void;
}

function DrawerBody({
  eventId, attendee, zoneAccess, zoneAccessLoading, zoneAccessError, zoneHistory, zoneHistoryLoading,
  zoneHistoryError, zones, zonesLoading, onClose, onEditBusyChange,
}: DrawerBodyProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fullName = `${attendee.first_name} ${attendee.last_name}`.trim();

  // "view" is the read-only shell Task 8 built; "edit" swaps the ENTIRE
  // body for EditAttendeeForm rather than turning individual fields inline
  // — the header/status pill/zone-access/activity/footer sections all stay
  // meaningful without a currently-being-edited attendee's fields
  // interleaved among them, and it avoids overlapping two independent
  // pieces of mutable state (the profile-edit form's dirty-tracking vs. the
  // zone chips' own add/remove affordances) in one render tree.
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [justSaved, setJustSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  const zoneNameById = new Map((zones ?? []).map(zoneIdentity).map((z) => [z.id, z.name]));
  function resolveZoneName(zoneId: string): string {
    // Honest fallback for an id the current zones list can't resolve
    // (deleted zone, race with a still-loading zones query, etc.) — never
    // crash, never show "undefined".
    return zoneNameById.get(zoneId) ?? zoneId.slice(0, 8);
  }

  const allowedZones = (zoneAccess ?? []).filter((entry) => entry.allowed);
  const grantedZoneIds = new Set(allowedZones.map((entry) => entry.zone_id));
  const availableZones = (zones ?? []).map(zoneIdentity).filter((z) => !grantedZoneIds.has(z.id));
  const recentActivity = (zoneHistory ?? []).slice(0, RECENT_ACTIVITY_LIMIT);

  // Shared disabled placeholder for the "+ Zone" add-affordance — rendered
  // both while zone-access/zones are still loading (we don't yet know
  // whether there's anything to add) and once loaded when there's genuinely
  // nothing left to grant. Extracted so those two cases render byte-for-byte
  // the same element instead of two independently-maintained copies.
  const addZonePlaceholder = (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className="inline-flex items-center rounded-full border border-dashed border-input px-2.5 py-0.5 text-caption text-muted-foreground disabled:cursor-not-allowed"
    >
      {t("drawerAddZone")}
    </button>
  );

  const checkedInParts = [t("drawerCheckedIn")];
  if (attendee.checked_in_at) checkedInParts.push(formatUtcHHMM(attendee.checked_in_at));
  if (attendee.checked_in_point_name) checkedInParts.push(attendee.checked_in_point_name);

  // Zone add/remove: per-click, not a batched/confirm-dialog flow (unlike
  // BulkBar's sequential per-attendee mutations), so there's no "cancel
  // while pending" dialog session to guard against — a click either fires
  // or it doesn't, and there's no local UI state here that a late response
  // could corrupt.
  //
  // Fix (Codex, PR #65): both also invalidate ATTENDEES_LIST_KEY now, not
  // just the zone-access query. A zone-access change doesn't touch any
  // field on the Attendee resource itself, but when the attendees table is
  // viewed with a `zone` filter active, that filter is evaluated server-side
  // against attendee_zone_access rows — so adding/removing a zone override
  // can change whether this attendee still belongs in that filtered page.
  // Without this, the table stays stale until an unrelated refetch.
  const addZoneAccess = $api.useMutation("post", "/api/attendees/{attendee_id}/zone-access", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_ZONE_ACCESS_KEY(attendee.id) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
    },
  });
  const removeZoneAccess = $api.useMutation("delete", "/api/attendee-zone-access/{id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_ZONE_ACCESS_KEY(attendee.id) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
    },
  });

  // Per-row pending state for zone-access removal, tracked independently of
  // the shared `removeZoneAccess` mutation's `.variables` — that field only
  // ever reflects the MOST RECENTLY fired call, so with multiple chips a
  // second remove click (on a different row) while the first is still in
  // flight would silently overwrite it, causing the FIRST chip's remove
  // button to look "done" (re-enabled) while its DELETE is still pending.
  // A double-click on that still-in-flight row would then fire a second
  // DELETE for an already-being-deleted row, which the backend correctly
  // 404s on (it's not idempotent). This Set is the source of truth for
  // "is THIS row's removal in flight" instead.
  const [pendingRemovalIds, setPendingRemovalIds] = React.useState<Set<string>>(new Set());

  function handleRemoveZoneAccess(rowId: string) {
    setPendingRemovalIds((prev) => new Set(prev).add(rowId));
    removeZoneAccess.mutate(
      { params: { path: { id: rowId } } },
      {
        // Runs in addition to the hook-level onSuccess above (react-query
        // calls both) — scoped to just this call's rowId via closure, so
        // it clears only this row's pending flag regardless of what other
        // removes are concurrently in flight.
        onSettled: () => {
          setPendingRemovalIds((prev) => {
            if (!prev.has(rowId)) return prev;
            const next = new Set(prev);
            next.delete(rowId);
            return next;
          });
        },
      },
    );
  }

  // Reprint badge (P3.2 Task 8): the drawer's own single-attendee print
  // flow, built entirely on usePrintBadge (the shared generate -> agent
  // print -> mark-printed -> invalidate flow Task 9's bulk loop will
  // reuse). Agent reachability is polled UNCONDITIONALLY while this drawer
  // is mounted (not gated behind the confirm dialog's own open state, the
  // way TestPrintDialog gates useAgentPrinters(open)) — the OUTER button
  // itself needs to know connectivity to decide whether it's even
  // clickable, per spec §7.3's reachability-gated idiom: the locked-forever
  // idiom this button used to show (Task 9, P2.1) is retired now that the
  // badge editor genuinely exists.
  const agent = useAgentPrinters(true);
  const printBadge = usePrintBadge(eventId);

  const [reprintOpen, setReprintOpen] = React.useState(false);
  // Only meaningful (and only ever rendered) when the agent has NO
  // configured default printer — see the inline <select> in the
  // ConfirmDialog below. When a default DOES exist, the flow always
  // targets it directly; this dialog never lets the operator second-guess
  // it (brief: deliberately NOT reusing TestPrintDialog's full
  // override-the-default UX here too — YAGNI).
  const [reprintPrinter, setReprintPrinter] = React.useState<string | null>(null);
  const [reprintPrinting, setReprintPrinting] = React.useState(false);
  const [reprintError, setReprintError] = React.useState<
    | { kind: "no-template" }
    // PR #74 review round Fix 8: distinct from "generic" so the honest,
    // named-family `drawerReprintMissingFont` copy renders instead of
    // MissingFontError's own bare `Error#message` (which the "generic"
    // branch would otherwise show verbatim).
    | { kind: "missing-font"; families: string[] }
    | { kind: "generic"; message: string }
    | null
  >(null);
  // Transient post-close status line (same idiom as `justSaved` below) —
  // `warning: true` is the MarkPrintedError soft-warning case: the badge
  // WAS sent (the send already happened), only the printed-count bump
  // failed, so this must never look like the destructive-red mutation
  // error the regenerate/delete dialogs show on a genuine failure.
  const [reprintSent, setReprintSent] = React.useState<{ printer: string; warning: boolean } | null>(null);
  const reprintSentTimeoutRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(reprintSentTimeoutRef.current), []);
  // Session-ref cancel-race guard — same idiom as regenerateSessionRef/
  // deleteSessionRef below: bumped on every genuine close so a print that
  // resolves/rejects AFTER the dialog session it was started in has ended
  // can never write its result into a later session's state. PR #74 review
  // round Fix 2: dismissal IS now blocked while printing (superseding the
  // earlier "never blocked, matching this drawer's own regenerate/delete
  // convention" choice — see handleReprintOpenChange below) for cross-
  // surface consistency with TestPrintDialog, which has always blocked
  // dismissal mid-print. This ref stays as defense-in-depth for a parent
  // forcing `open` closed directly (same rationale as TestPrintDialog's own
  // sessionRef comment), not as the primary guard against a mid-print
  // close anymore.
  const reprintSessionRef = React.useRef(0);

  // `configuredDefault` (NOT `defaultPrinter`) is the "does a real default
  // exist" question — `defaultPrinter` always resolves to SOMETHING once
  // any printer exists (useAgentPrinters' own "always have a preselection"
  // fallback, meant for TestPrintDialog's always-visible select), which
  // would otherwise make the choose-a-printer branch never fire once any
  // printer is connected. Review fix (Minor): validated against the LIVE
  // printer list too — the agent's configured default can name a printer
  // that has since been unplugged/removed, and naming (or sending to) a
  // printer that no longer exists would be dishonest; a stale default
  // falls through to the inline-select path exactly as if none were
  // configured. Same web-parity presence rule `defaultPrinter` itself
  // applies inside useAgentPrinters.
  const reprintConfiguredDefault =
    agent.configuredDefault && agent.printers.some((printer) => printer.name === agent.configuredDefault)
      ? agent.configuredDefault
      : null;

  React.useEffect(() => {
    if (!reprintOpen) return;
    if (reprintConfiguredDefault) return;
    if (reprintPrinter && agent.printers.some((printer) => printer.name === reprintPrinter)) return;
    // `defaultPrinter` is still the right PRESELECTION for the <select> —
    // it degrades to "first printer" in exactly this no-(valid-)configured-
    // default case.
    setReprintPrinter(agent.defaultPrinter);
  }, [reprintOpen, reprintConfiguredDefault, agent.defaultPrinter, agent.printers, reprintPrinter]);

  const reprintAgentDisconnected = agent.state === "disconnected";
  const reprintTargetPrinter = reprintConfiguredDefault ?? reprintPrinter;
  // Reconciliation #9 (fonts must be awaited before generation): the
  // hook's own printAttendee already awaits this internally, but gating the
  // confirm button on it too means the operator never sees a click silently
  // "hang" mid-flight waiting on a fonts fetch that just hasn't settled yet.
  const reprintFontsBlocking = printBadge.fontsStatus !== "ready" && printBadge.fontsStatus !== "error";

  // PR #74 review round Fix 2: wraps the `onOpenChange` prop for EVERY
  // dismiss path Radix's Dialog routes through it (X close button, Escape,
  // overlay/outside click, and the Cancel button below) — same idiom as
  // AddAttendeeDialog.tsx's/TestPrintDialog.tsx's own `handleOpenChange`.
  // While a print is genuinely in flight, a close attempt is a flat no-op:
  // the send continues in the background and the dialog stays open until it
  // settles, so the operator always sees the outcome (sent / soft warning /
  // failure) rather than being able to dismiss the dialog mid-flight and
  // lose track of whether the badge was actually sent. This supersedes the
  // earlier "dismissal is never blocked" choice (this drawer's own
  // regenerate/delete convention) specifically for reprint, for consistency
  // with TestPrintDialog's identical mid-print lock.
  function handleReprintOpenChange(open: boolean) {
    if (!open && reprintPrinting) return;
    if (!open) {
      reprintSessionRef.current += 1;
      setReprintError(null);
      setReprintPrinter(null);
      // `reprintPrinting` is already false whenever this branch runs now
      // (the guard above bails out while it's true) — kept as defense-in-
      // depth for a parent forcing `open` closed directly, same rationale
      // as TestPrintDialog's own sessionRef comment.
      setReprintPrinting(false);
    }
    setReprintOpen(open);
  }

  // Same idiom as AddAttendeeDialog.tsx's/TestPrintDialog.tsx's own
  // `preventDialogDismiss` — Radix's DismissableLayer calls this BEFORE
  // `onOpenChange` for Escape/outside-click/focus-outside, so preventing
  // the default here (in addition to the guarded `handleReprintOpenChange`
  // above) stops the keystroke/click from also bubbling to any OTHER
  // page-level handler (e.g. the drawer's own Sheet) while a print is in
  // flight, not just from closing this dialog.
  function preventReprintDialogDismiss(e: Event) {
    if (reprintPrinting) e.preventDefault();
  }

  async function handleReprintConfirm() {
    const printerName = reprintTargetPrinter;
    if (!printerName) return;
    const mySession = reprintSessionRef.current;
    setReprintError(null);
    setReprintPrinting(true);
    try {
      await printBadge.printAttendee(attendee, printerName);
      if (mySession !== reprintSessionRef.current) return;
      setReprintOpen(false);
      window.clearTimeout(reprintSentTimeoutRef.current);
      setReprintSent({ printer: printerName, warning: false });
      reprintSentTimeoutRef.current = window.setTimeout(() => setReprintSent(null), 4000);
    } catch (error) {
      if (mySession !== reprintSessionRef.current) return;
      if (error instanceof MarkPrintedError) {
        // Non-fatal (brief's honesty rule): the badge WAS sent — this
        // closes and reports success-with-a-caveat, never the harsh
        // failure copy below.
        setReprintOpen(false);
        window.clearTimeout(reprintSentTimeoutRef.current);
        setReprintSent({ printer: printerName, warning: true });
        reprintSentTimeoutRef.current = window.setTimeout(() => setReprintSent(null), 4000);
        return;
      }
      if (error instanceof NoTemplateError) {
        setReprintError({ kind: "no-template" });
        return;
      }
      // PR #74 review round Fix 8: pre-send failure (usePrintBadge throws
      // this BEFORE any agent call) — named-family message, never the
      // generic fallback below.
      if (error instanceof MissingFontError) {
        setReprintError({ kind: "missing-font", families: error.families });
        return;
      }
      // Follow-up batch item 2: a timed-out send is not a PROVEN failure —
      // the abort only cancelled our wait, the agent may have received the
      // job and the badge may still emerge. The generic branch below would
      // show the client-authored (non-i18n) message verbatim AND read like
      // a plain failure, inviting an immediate double print — dedicated
      // honest copy instead.
      if (error instanceof AgentPrintTimeoutError) {
        setReprintError({ kind: "generic", message: t("drawerReprintTimeout") });
        return;
      }
      setReprintError({
        kind: "generic",
        message: error instanceof Error ? error.message : t("drawerReprintError"),
      });
    } finally {
      if (mySession === reprintSessionRef.current) setReprintPrinting(false);
    }
  }

  const reprintDescription = (
    <>
      <span className="block">
        {reprintConfiguredDefault
          ? t("drawerReprintConfirmBody", { name: fullName, printer: reprintConfiguredDefault })
          : t("drawerReprintConfirmBodyChoose", { name: fullName })}
      </span>
      {!reprintConfiguredDefault ? (
        <span className="mt-2 flex flex-col gap-2">
          <Label htmlFor="reprint-printer">{t("printPrinterLabel")}</Label>
          <select
            id="reprint-printer"
            className={REPRINT_SELECT_CLASSNAME}
            value={reprintPrinter ?? ""}
            disabled={agent.printers.length === 0 || reprintPrinting}
            onChange={(event) => setReprintPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </select>
        </span>
      ) : null}
      {reprintPrinting ? (
        // Follow-up batch item 4: dismissal is locked while the send is in
        // flight (Fix 2) — this line explains WHY the disabled Cancel isn't
        // a broken button, and heads off the "closing would have stopped
        // it" assumption. Transport-ack truth: a send can't be recalled.
        <span className="mt-2 block">{t("drawerReprintNoCancelHint")}</span>
      ) : null}
      {printBadge.fontsStatus === "error" ? (
        <span className="mt-2 block text-warning">{t("badgeFontsNotReady")}</span>
      ) : null}
      {reprintError?.kind === "no-template" ? (
        <span className="mt-2 block text-destructive">
          {t("drawerReprintNoTemplate")}{" "}
          <Link to="/events/$eventId/badge" params={{ eventId }} className="underline">
            {t("drawerReprintOpenEditor")}
          </Link>
        </span>
      ) : null}
      {reprintError?.kind === "missing-font" ? (
        <span className="mt-2 block text-destructive">
          {t("drawerReprintMissingFont", { families: reprintError.families.join(", ") })}{" "}
          <Link to="/events/$eventId/badge" params={{ eventId }} className="underline">
            {t("drawerReprintOpenEditor")}
          </Link>
        </span>
      ) : null}
      {reprintError?.kind === "generic" ? (
        <span className="mt-2 block text-destructive">{reprintError.message}</span>
      ) : null}
    </>
  );

  // Regenerate code: tier-1 (not typed) destructive confirm. Same
  // session-id-ref cancel guard as DangerZoneCard.tsx/ApiKeysCard.tsx —
  // `regenerateCode.reset()` on close only detaches the mutation observer,
  // it does not cancel an in-flight PATCH or stop a late onSuccess/onError
  // from firing. Cache invalidation runs unconditionally (the code
  // genuinely changed server-side even if the user "cancelled" the dialog
  // before the response landed); only the dialog-closing/error-surfacing
  // UI reactions are gated on the session check.
  const [regenerateOpen, setRegenerateOpen] = React.useState(false);
  const [regenerateError, setRegenerateError] = React.useState(false);
  const regenerateSessionRef = React.useRef(0);

  const regenerateCode = $api.useMutation("patch", "/api/attendees/{id}", {
    onMutate: () => ({ sessionId: regenerateSessionRef.current }),
    onSuccess: (_data, _vars, onMutateResult) => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_DETAIL_KEY(attendee.id) });
      if (onMutateResult?.sessionId !== regenerateSessionRef.current) return;
      setRegenerateOpen(false);
    },
    onError: (_error, _vars, onMutateResult) => {
      if (onMutateResult?.sessionId !== regenerateSessionRef.current) return;
      setRegenerateError(true);
    },
  });

  function handleRegenerateOpenChange(open: boolean) {
    if (!open) {
      // Any response still in flight from this session is now permanently
      // stale — a later reopen gets a new session id, so it can never match
      // again, even across a second cancel-then-reopen cycle.
      regenerateSessionRef.current += 1;
      setRegenerateError(false);
      regenerateCode.reset();
    }
    setRegenerateOpen(open);
  }

  // Delete attendee: tier-1 (not typed — a single-attendee delete, not the
  // bulk/event-wide ops that use typed confirmation) destructive confirm.
  // Same session-id-ref guard shape as regenerate above. On success this
  // closes the WHOLE drawer via `onClose` (the same mechanism the drawer's
  // built-in Sheet close affordance uses, which clears the `?attendee=`
  // search param — see AttendeesPage.tsx's closeAttendee) rather than just
  // this confirm dialog, since the attendee this drawer is showing no
  // longer exists.
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState(false);
  const deleteSessionRef = React.useRef(0);

  const deleteAttendee = $api.useMutation("delete", "/api/attendees/{id}", {
    onMutate: () => ({ sessionId: deleteSessionRef.current }),
    onSuccess: (_data, _vars, onMutateResult) => {
      // Readiness too: the deletion changes the live attendee count the
      // backend recomputes the rail's attendees step from — unconditional,
      // same as the list invalidation (the delete really happened
      // server-side even if the user backed out of the dialog session).
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: READINESS_KEY(eventId) });
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setDeleteOpen(false);
      onClose();
    },
    onError: (_error, _vars, onMutateResult) => {
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setDeleteError(true);
    },
  });

  function handleDeleteOpenChange(open: boolean) {
    if (!open) {
      deleteSessionRef.current += 1;
      setDeleteError(false);
      deleteAttendee.reset();
    }
    setDeleteOpen(open);
  }

  if (mode === "edit") {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="bg-success/10 text-caption font-semibold text-success">
              {initials(attendee.first_name, attendee.last_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-0.5">
            <p className="text-body font-bold text-foreground">{fullName}</p>
            <p className="text-caption text-muted-foreground">
              {attendee.company ? `${attendee.company} · ` : ""}
              <span className="font-mono">{attendee.code}</span>
            </p>
          </div>
        </div>
        <EditAttendeeForm
          attendee={attendee}
          eventId={eventId}
          onCancel={() => setMode("view")}
          onBusyChange={onEditBusyChange}
          onSaved={() => {
            setMode("view");
            setJustSaved(true);
            window.clearTimeout(savedTimeoutRef.current);
            savedTimeoutRef.current = window.setTimeout(() => setJustSaved(false), 2000);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 1. Header: 36px initials avatar + bold name + "{company} · {code}"
          subline (company omitted gracefully when blank). */}
      <div className="flex items-start gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarFallback className="bg-success/10 text-caption font-semibold text-success">
            {initials(attendee.first_name, attendee.last_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-0.5">
          <p className="text-body font-bold text-foreground">{fullName}</p>
          <p data-testid="attendee-drawer-subline" className="text-caption text-muted-foreground">
            {attendee.company ? `${attendee.company} · ` : ""}
            <span className="font-mono">{attendee.code}</span>
          </p>
        </div>
      </div>

      {/* 2. Status pill row — own row, not inline with the header. WCAG
          1.4.1: icon + text + color together, never color alone. */}
      <div>
        {attendee.checkin_status ? (
          <StatusPill status="ready" label={checkedInParts.join(" · ")} />
        ) : (
          <StatusPill status="empty" label={t("drawerNotCheckedIn")} />
        )}
      </div>

      {/* 3. Action row. */}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => setMode("edit")}>
          {t("drawerEdit")}
        </Button>
        {/* Live now (P3.2 Task 8) — the badge editor exists, so the OLD
            permanent lock is retired. Reachability-gated instead (spec
            §7.3 idiom): disabled + a native `title` tooltip whenever the
            agent isn't connected, never a silent no-op. No Lock icon here
            — that idiom is reserved for features that don't exist yet;
            this one exists, it's just temporarily unreachable. */}
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={agent.state !== "connected" || reprintPrinting}
          aria-disabled={agent.state !== "connected" || reprintPrinting}
          title={reprintAgentDisconnected ? t("drawerReprintUnreachable") : undefined}
          onClick={() => {
            setReprintError(null);
            setReprintOpen(true);
          }}
        >
          {t("drawerReprint")}
        </Button>
      </div>
      {justSaved ? <span className="text-caption text-muted-foreground">{t("settingsSaved")}</span> : null}
      {reprintSent ? (
        <span className={reprintSent.warning ? "text-caption text-warning" : "text-caption text-muted-foreground"}>
          {reprintSent.warning
            ? t("drawerReprintMarkPrintedWarning", { printer: reprintSent.printer })
            : t("printSentTo", { printer: reprintSent.printer })}
        </span>
      ) : null}

      {/* 4. Zone access — success chips for allowed=true rows, resolved to
          zone names, each with a small remove (×) affordance keyed on the
          zone-access ROW id (not the zone id — DELETE
          /api/attendee-zone-access/{id} needs the row). Dashed "+ Zone"
          add-chip opens a dropdown of zones not yet granted. A failed
          zone-access fetch gets its own honest error message rather than
          silently rendering identically to "no zone access" — this is a
          check-in-adjacent tool, so an operator glancing at the drawer
          during a transient failure must not be able to mistake "we don't
          know" for "this attendee genuinely has none". */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-caption font-medium uppercase text-muted-foreground">{t("drawerZoneAccess")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {zoneAccessLoading || zonesLoading ? (
            <>
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </>
          ) : zoneAccessError ? (
            <p className="text-caption text-destructive">{t("drawerZoneAccessLoadError")}</p>
          ) : (
            allowedZones.map((entry) => {
              const name = resolveZoneName(entry.zone_id);
              const removing = pendingRemovalIds.has(entry.id);
              return (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1 rounded-full border border-transparent bg-success/10 pl-2.5 pr-1 py-0.5 text-caption font-medium text-success"
                >
                  {name}
                  <button
                    type="button"
                    aria-label={t("drawerRemoveZone", { name })}
                    disabled={removing}
                    className="rounded-full px-1 leading-none text-success/70 hover:text-success disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => handleRemoveZoneAccess(entry.id)}
                  >
                    ×
                  </button>
                </span>
              );
            })
          )}
          {/* Hidden while the zone-access fetch is errored: offering to add
              MORE zones when we don't actually know the attendee's current
              zone access is confusing UI. Explicitly gated on the loading
              states too (not just `availableZones.length > 0`) — while
              zone-access/zones are still loading, `availableZones` happens
              to compute as an empty array (both queries are `undefined` →
              `?? []`), so the disabled placeholder rendering during loading
              must be an explicit "we don't know yet" case, not a coincidence
              of "genuinely zero zones available" sharing the same branch. */}
          {zoneAccessError ? null : zoneAccessLoading || zonesLoading ? (
            addZonePlaceholder
          ) : availableZones.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={addZoneAccess.isPending}
                  className="inline-flex items-center rounded-full border border-dashed border-input px-2.5 py-0.5 text-caption text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("drawerAddZone")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {availableZones.map((zone) => (
                  <DropdownMenuItem
                    key={zone.id}
                    onSelect={() =>
                      addZoneAccess.mutate({
                        params: { path: { attendee_id: attendee.id } },
                        body: { zone_id: zone.id, allowed: true },
                      })
                    }
                  >
                    {zone.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            addZonePlaceholder
          )}
        </div>
        {/* Fix (Codex, PR #65): addZoneAccess previously had no onError
            handling at all — a failed POST left the dropdown just closing
            with no explanation, indistinguishable from the operator having
            changed their mind. isError already resets to false the moment a
            NEW mutate() call starts (react-query's normal per-call status
            lifecycle), so this needs no extra reset wiring of its own. */}
        {addZoneAccess.isError ? (
          <p className="text-caption text-destructive">{t("drawerAddZoneError")}</p>
        ) : null}
      </div>

      {/* 5. Recent activity — up to 3 rows, API order trusted verbatim
          (most-recent-first per the backend contract), zone_name only (no
          device field — the API doesn't return one, and this task doesn't
          fabricate data). No "Full timeline →" link — the plan explicitly
          excludes it since the target full-page view isn't built in P2. */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-caption font-medium uppercase text-muted-foreground">{t("drawerActivity")}</span>
        {zoneHistoryLoading ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : zoneHistoryError ? (
          <p className="text-caption text-destructive">{t("drawerActivityLoadError")}</p>
        ) : recentActivity.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("drawerNoActivity")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentActivity.map((entry) => (
              <li key={entry.checkin.id} className="text-caption text-muted-foreground">
                {formatUtcHHMM(entry.checkin.checked_in_at)} —{" "}
                {entry.zone_name || t("drawerActivityUnknownZone")}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6. Footer — pinned to the bottom, destructive-red links. */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <button
          type="button"
          className="text-caption text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            setRegenerateError(false);
            setRegenerateOpen(true);
          }}
        >
          {t("drawerRegenerate")}
        </button>
        <button
          type="button"
          className="text-caption text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            setDeleteError(false);
            setDeleteOpen(true);
          }}
        >
          {t("drawerDelete")}
        </button>
      </div>

      <ConfirmDialog
        open={regenerateOpen}
        onOpenChange={handleRegenerateOpenChange}
        title={t("drawerRegenerateTitle")}
        description={
          regenerateError ? (
            <>
              {t("drawerRegenerateBody")}
              <span className="mt-1 block text-destructive">{t("drawerMutationError")}</span>
            </>
          ) : (
            t("drawerRegenerateBody")
          )
        }
        confirmLabel={t("drawerRegenerateConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={regenerateCode.isPending}
        onConfirm={() => {
          setRegenerateError(false);
          regenerateCode.mutate({ params: { path: { id: attendee.id } }, body: { code: crypto.randomUUID() } });
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        title={t("drawerDeleteTitle")}
        description={
          deleteError ? (
            <>
              {t("drawerDeleteBody", { name: fullName })}
              <span className="mt-1 block text-destructive">{t("drawerMutationError")}</span>
            </>
          ) : (
            t("drawerDeleteBody", { name: fullName })
          )
        }
        confirmLabel={t("drawerDeleteConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={deleteAttendee.isPending}
        onConfirm={() => {
          setDeleteError(false);
          deleteAttendee.mutate({ params: { path: { id: attendee.id } } });
        }}
      />

      {/* PR #74 review round Fix 2: hand-built (not the shared ConfirmDialog)
          so this dialog can block ALL dismiss paths while printing, the same
          way TestPrintDialog.tsx/AddAttendeeDialog.tsx do — ConfirmDialog
          itself has no onEscapeKeyDown/onPointerDownOutside/onInteractOutside/
          hideClose passthrough, and every OTHER ConfirmDialog in this file
          (regenerate/delete) genuinely doesn't need this, so the shared
          component's public API is left alone. */}
      <Dialog open={reprintOpen} onOpenChange={handleReprintOpenChange}>
        <DialogContent
          closeLabel={t("workspaceDialogClose")}
          hideClose={reprintPrinting}
          onEscapeKeyDown={preventReprintDialogDismiss}
          onPointerDownOutside={preventReprintDialogDismiss}
          onInteractOutside={preventReprintDialogDismiss}
        >
          <DialogHeader>
            <DialogTitle>{t("drawerReprintConfirmTitle")}</DialogTitle>
            <DialogDescription>{reprintDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reprintPrinting}
              onClick={() => handleReprintOpenChange(false)}
            >
              {t("createEventCancel")}
            </Button>
            <Button
              type="button"
              disabled={
                reprintPrinting || !reprintTargetPrinter || agent.state !== "connected" || reprintFontsBlocking
              }
              onClick={() => void handleReprintConfirm()}
            >
              {t("drawerReprintConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
