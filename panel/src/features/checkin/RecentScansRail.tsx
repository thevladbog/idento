// P4.1 Task 9 -- the check-in station's recent-scans rail. Fills
// StationPage.tsx's placeholder aside (Task 8) with the last-50
// checkin-actions feed (Task 5's useCheckinActions) and its per-row
// Reprint/Undo/Details actions.
//
// CheckinActionRow's own `attendee` field is a SLIM projection (id,
// first_name, last_name, code -- schema.d.ts's CheckinActionAttendee) --
// NOT enough to print from (usePrintBadge's attendeeToPreviewData also
// needs email/company/position/custom_fields). Reprint therefore fetches
// the FULL Attendee via GET /api/attendees/{id} (attendees/hooks.ts's own
// query key) immediately before calling printAttendee, mirroring how
// usePrintBadge itself fetches the badge template via
// queryClient.fetchQuery rather than trusting a stale/absent `.data`
// snapshot.
//
// Reprint's confirm dialog is a hand-built Dialog (not the shared
// ConfirmDialog, which has no onEscapeKeyDown/onPointerDownOutside/
// onInteractOutside/hideClose passthrough) that BLOCKS every dismissal
// path while the send is in flight -- the exact P3.2 PR-#74 convention
// AttendeeDrawer.tsx's own Reprint dialog established (see that file's own
// comment on `handleReprintOpenChange`). The plan's global constraints call
// this out explicitly for BOTH reprint and undo here, so Undo's confirm
// dialog is hand-built the same way, even though undo itself isn't a
// physical-output action -- consistency across this rail's two mutation
// confirms beats a bespoke lighter-weight dialog for just one of them.
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Label, Skeleton,
} from "@idento/ui";
import { useTranslation } from "react-i18next";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import { AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { MarkPrintedError, MissingFontError, NoTemplateError, usePrintBadge } from "../badge/zpl/usePrintBadge";
import { CHECKIN_ACTIONS_KEY, useCheckinActions, useUndoCheckin } from "./hooks";

type CheckinActionRow = components["schemas"]["CheckinActionRow"];

// Native <select>, styled to match PropertiesPane.tsx's/TestPrintDialog.tsx's/
// AttendeeDrawer.tsx's own SELECT_CLASSNAME (duplicated per-file on purpose --
// see those files' own comments: there's no shared @idento/ui Select
// primitive yet).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const ACTION_LABEL_KEY: Record<CheckinActionRow["action"], string> = {
  checkin: "checkinActionCheckin",
  undo: "checkinActionUndo",
  reprint: "checkinActionReprint",
};

// Hand-rolled UTC HH:MM formatter -- same convention (duplicated per-file
// on purpose) as AttendeeDrawer.tsx's and VerdictCard.tsx's own private
// formatUtcHHMM: a viewer's local timezone must never shift a
// server-recorded check-in/undo/reprint moment.
function formatUtcHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export interface RecentScansRailProps {
  eventId: string;
  // The registered station this rail is mounted at -- forwarded as
  // `station_id` on both the reprint printContext and the undo request
  // body (schema.d.ts's UndoCheckinRequest: optional, recorded on the
  // feed row only). `null` is a valid station-less rail.
  stationId: string | null;
}

export function RecentScansRail({ eventId, stationId }: RecentScansRailProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const actionsQuery = useCheckinActions(eventId);
  const agent = useAgentPrinters(true);
  const printBadge = usePrintBadge(eventId);
  const undoCheckin = useUndoCheckin(eventId);

  const rows = actionsQuery.data?.actions ?? [];

  // ---------------------------------------------------------------------
  // Reprint -- single shared dialog, targeted at whichever row's Reprint
  // button was clicked (only one Radix Dialog can be meaningfully open at
  // once, so a single `reprintTarget` replaces per-row state).
  // ---------------------------------------------------------------------
  const [reprintTarget, setReprintTarget] = React.useState<CheckinActionRow | null>(null);
  const [reprintPrinter, setReprintPrinter] = React.useState<string | null>(null);
  const [reprintPrinting, setReprintPrinting] = React.useState(false);
  const [reprintError, setReprintError] = React.useState<
    | { kind: "no-template" }
    | { kind: "missing-font"; families: string[] }
    | { kind: "generic"; message: string }
    | null
  >(null);
  const [reprintSent, setReprintSent] = React.useState<{ printer: string; warning: boolean } | null>(null);
  const reprintSentTimeoutRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(reprintSentTimeoutRef.current), []);
  // Session-ref cancel-race guard -- same idiom as AttendeeDrawer.tsx's
  // reprintSessionRef: bumped on every genuine close so a print that
  // resolves/rejects AFTER the dialog session it was started in has ended
  // can never write its result into a later session's state.
  const reprintSessionRef = React.useRef(0);

  // Same "does a real configured default exist" question AttendeeDrawer.tsx
  // asks -- validated against the LIVE printer list (a configured default
  // can name a printer that's since been unplugged/removed).
  const reprintConfiguredDefault =
    agent.configuredDefault && agent.printers.some((printer) => printer.name === agent.configuredDefault)
      ? agent.configuredDefault
      : null;

  React.useEffect(() => {
    if (!reprintTarget) return;
    if (reprintConfiguredDefault) return;
    if (reprintPrinter && agent.printers.some((printer) => printer.name === reprintPrinter)) return;
    setReprintPrinter(agent.defaultPrinter);
  }, [reprintTarget, reprintConfiguredDefault, agent.defaultPrinter, agent.printers, reprintPrinter]);

  const reprintAgentDisconnected = agent.state === "disconnected";
  const reprintTargetPrinter = reprintConfiguredDefault ?? reprintPrinter;
  const reprintFontsBlocking = printBadge.fontsStatus !== "ready" && printBadge.fontsStatus !== "error";

  function handleReprintOpenChange(open: boolean) {
    if (!open && reprintPrinting) return;
    if (!open) {
      reprintSessionRef.current += 1;
      setReprintError(null);
      setReprintPrinter(null);
      setReprintPrinting(false);
      setReprintTarget(null);
    }
  }

  function preventReprintDialogDismiss(e: Event) {
    if (reprintPrinting) e.preventDefault();
  }

  async function handleReprintConfirm() {
    if (!reprintTarget) return;
    const printerName = reprintTargetPrinter;
    if (!printerName) return;
    const rowAttendeeId = reprintTarget.attendee.id;
    const mySession = reprintSessionRef.current;
    setReprintError(null);
    setReprintPrinting(true);
    try {
      // The rail's own slim CheckinActionAttendee projection can't feed
      // attendeeToPreviewData (it's missing email/company/position/
      // custom_fields) -- fetch the FULL record first, same "fetchQuery,
      // never a stale/absent .data snapshot" idiom usePrintBadge itself
      // uses for the badge template.
      const attendee = await queryClient.fetchQuery(
        $api.queryOptions("get", "/api/attendees/{id}", { params: { path: { id: rowAttendeeId } } }),
      );
      await printBadge.printAttendee(attendee, printerName, {
        printContext: { eventId, stationId },
      });
      if (mySession !== reprintSessionRef.current) return;
      // usePrintBadge's own invalidation only covers ATTENDEES_LIST_KEY/
      // ATTENDEE_DETAIL_KEY (it knows nothing about the check-in domain) --
      // the backend's reprint-logging (Task 4) inserts a NEW checkin_actions
      // row on every successful reprint, so this rail must refetch its own
      // feed itself (spec §4: "Rail refetches on the station's own
      // check-in/undo/reprint mutations").
      void queryClient.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY(eventId) });
      setReprintTarget(null);
      window.clearTimeout(reprintSentTimeoutRef.current);
      setReprintSent({ printer: printerName, warning: false });
      reprintSentTimeoutRef.current = window.setTimeout(() => setReprintSent(null), 4000);
    } catch (error) {
      if (mySession !== reprintSessionRef.current) return;
      if (error instanceof MarkPrintedError) {
        // Non-fatal: the badge WAS sent (and the reprint feed row is
        // already committed server-side by the time markPrinted runs) --
        // this closes and reports success-with-a-caveat, never the harsh
        // failure copy below.
        void queryClient.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY(eventId) });
        setReprintTarget(null);
        window.clearTimeout(reprintSentTimeoutRef.current);
        setReprintSent({ printer: printerName, warning: true });
        reprintSentTimeoutRef.current = window.setTimeout(() => setReprintSent(null), 4000);
        return;
      }
      if (error instanceof NoTemplateError) {
        setReprintError({ kind: "no-template" });
        return;
      }
      if (error instanceof MissingFontError) {
        setReprintError({ kind: "missing-font", families: error.families });
        return;
      }
      // A timed-out send is not a PROVEN failure -- the abort only
      // cancelled the client's wait; the agent may have received the job
      // and the badge may still emerge (same honest copy as
      // AttendeeDrawer.tsx's/TestPrintDialog.tsx's own reprint/test-print
      // flows).
      if (error instanceof AgentPrintTimeoutError) {
        setReprintError({ kind: "generic", message: t("printAgentTimeout") });
        return;
      }
      setReprintError({
        kind: "generic",
        message: error instanceof Error ? error.message : t("checkinReprintError"),
      });
    } finally {
      if (mySession === reprintSessionRef.current) setReprintPrinting(false);
    }
  }

  // ---------------------------------------------------------------------
  // Undo -- single shared dialog, same targeted-row shape as Reprint above.
  // ---------------------------------------------------------------------
  const [undoTarget, setUndoTarget] = React.useState<CheckinActionRow | null>(null);
  const [undoError, setUndoError] = React.useState(false);
  const undoSessionRef = React.useRef(0);

  function handleUndoOpenChange(open: boolean) {
    if (!open && undoCheckin.isPending) return;
    if (!open) {
      undoSessionRef.current += 1;
      setUndoError(false);
      undoCheckin.reset();
      setUndoTarget(null);
    }
  }

  function preventUndoDialogDismiss(e: Event) {
    if (undoCheckin.isPending) e.preventDefault();
  }

  function handleUndoConfirm() {
    if (!undoTarget) return;
    const mySession = undoSessionRef.current;
    setUndoError(false);
    undoCheckin.mutate(
      {
        params: { path: { event_id: eventId } },
        body: { attendee_id: undoTarget.attendee.id, station_id: stationId },
      },
      {
        // The shared hook's OWN onSuccess (hooks.ts) already invalidates
        // CHECKIN_ACTIONS_KEY + ATTENDEES_LIST_KEY unconditionally -- these
        // call-site callbacks only drive this dialog's own UI reaction,
        // gated on the session so a cancel-then-reopen cycle can't have a
        // stale response write into a later session's state.
        onSuccess: () => {
          if (mySession !== undoSessionRef.current) return;
          setUndoTarget(null);
        },
        onError: () => {
          if (mySession !== undoSessionRef.current) return;
          setUndoError(true);
        },
      },
    );
  }

  // ---------------------------------------------------------------------
  // Rendering.
  // ---------------------------------------------------------------------

  const anyMutationPending = reprintPrinting || undoCheckin.isPending;

  const reprintDescription = reprintTarget ? (
    <>
      <span className="block">
        {reprintConfiguredDefault
          ? t("checkinReprintConfirmBody", {
              name: `${reprintTarget.attendee.first_name} ${reprintTarget.attendee.last_name}`,
              printer: reprintConfiguredDefault,
            })
          : t("checkinReprintConfirmBodyChoose", {
              name: `${reprintTarget.attendee.first_name} ${reprintTarget.attendee.last_name}`,
            })}
      </span>
      {!reprintConfiguredDefault ? (
        <span className="mt-2 flex flex-col gap-2">
          <Label htmlFor="checkin-reprint-printer">{t("printPrinterLabel")}</Label>
          <select
            id="checkin-reprint-printer"
            className={SELECT_CLASSNAME}
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
      {reprintPrinting ? <span className="mt-2 block">{t("printNoCancelHint")}</span> : null}
      {printBadge.fontsStatus === "error" ? (
        <span className="mt-2 block text-warning">{t("badgeFontsNotReady")}</span>
      ) : null}
      {reprintError?.kind === "no-template" ? (
        <span className="mt-2 block text-destructive">
          {t("checkinReprintNoTemplate")}{" "}
          <Link to="/events/$eventId/badge" params={{ eventId }} className="underline">
            {t("checkinReprintOpenEditor")}
          </Link>
        </span>
      ) : null}
      {reprintError?.kind === "missing-font" ? (
        <span className="mt-2 block text-destructive">
          {t("checkinReprintMissingFont", { families: reprintError.families.join(", ") })}{" "}
          <Link to="/events/$eventId/badge" params={{ eventId }} className="underline">
            {t("checkinReprintOpenEditor")}
          </Link>
        </span>
      ) : null}
      {reprintError?.kind === "generic" ? (
        <span className="mt-2 block text-destructive">{reprintError.message}</span>
      ) : null}
    </>
  ) : null;

  return (
    <div className="flex h-full flex-col gap-3" data-testid="checkin-recent-scans-rail">
      <h2 className="text-caption font-medium uppercase text-muted-foreground">{t("checkinRailTitle")}</h2>

      {actionsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : actionsQuery.isError ? (
        <p className="text-body text-destructive">{t("checkinRailLoadError")}</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("checkinRailEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1.5 rounded-md border border-border p-2"
              data-testid="checkin-rail-row"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body font-medium text-foreground">
                  {row.attendee.first_name} {row.attendee.last_name}
                </span>
                <span className="shrink-0 text-caption text-muted-foreground">{formatUtcHHMM(row.created_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-caption text-muted-foreground">{row.attendee.code}</span>
                <span className="text-caption text-muted-foreground">{t(ACTION_LABEL_KEY[row.action])}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={agent.state !== "connected" || anyMutationPending}
                  aria-disabled={agent.state !== "connected" || anyMutationPending}
                  title={reprintAgentDisconnected ? t("checkinRailReprintUnreachable") : undefined}
                  onClick={() => {
                    setReprintError(null);
                    setReprintTarget(row);
                  }}
                >
                  {t("checkinRailReprint")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={anyMutationPending}
                  onClick={() => {
                    setUndoError(false);
                    setUndoTarget(row);
                  }}
                >
                  {t("checkinRailUndo")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="outline">
                      {t("checkinRailDetails")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="flex flex-col gap-1 p-3">
                    <span className="text-body font-medium text-foreground">
                      {row.attendee.first_name} {row.attendee.last_name}
                    </span>
                    <span className="font-mono text-caption text-muted-foreground">{row.attendee.code}</span>
                    <span className="text-caption text-muted-foreground">
                      {row.action === "checkin"
                        ? t("checkinFirstScanAt", { time: formatUtcHHMM(row.created_at) })
                        : row.action === "undo"
                          ? t("checkinDetailsUndoneAt", { time: formatUtcHHMM(row.created_at) })
                          : t("checkinDetailsReprintedAt", { time: formatUtcHHMM(row.created_at) })}
                    </span>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}

      {reprintSent ? (
        <span className={reprintSent.warning ? "text-caption text-warning" : "text-caption text-muted-foreground"}>
          {reprintSent.warning
            ? t("checkinReprintMarkPrintedWarning", { printer: reprintSent.printer })
            : t("printSentTo", { printer: reprintSent.printer })}
        </span>
      ) : null}

      <Dialog open={reprintTarget !== null} onOpenChange={handleReprintOpenChange}>
        <DialogContent
          closeLabel={t("workspaceDialogClose")}
          hideClose={reprintPrinting}
          onEscapeKeyDown={preventReprintDialogDismiss}
          onPointerDownOutside={preventReprintDialogDismiss}
          onInteractOutside={preventReprintDialogDismiss}
        >
          <DialogHeader>
            <DialogTitle>{t("checkinReprintConfirmTitle")}</DialogTitle>
            <DialogDescription>{reprintDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={reprintPrinting} onClick={() => handleReprintOpenChange(false)}>
              {t("createEventCancel")}
            </Button>
            <Button
              type="button"
              disabled={
                reprintPrinting || !reprintTargetPrinter || agent.state !== "connected" || reprintFontsBlocking
              }
              onClick={() => void handleReprintConfirm()}
            >
              {t("checkinReprintConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={undoTarget !== null} onOpenChange={handleUndoOpenChange}>
        <DialogContent
          closeLabel={t("workspaceDialogClose")}
          hideClose={undoCheckin.isPending}
          onEscapeKeyDown={preventUndoDialogDismiss}
          onPointerDownOutside={preventUndoDialogDismiss}
          onInteractOutside={preventUndoDialogDismiss}
        >
          <DialogHeader>
            <DialogTitle>{t("checkinUndoConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {undoTarget
                ? t("checkinUndoConfirmBody", {
                    name: `${undoTarget.attendee.first_name} ${undoTarget.attendee.last_name}`,
                  })
                : null}
              {undoError ? <span className="mt-2 block text-destructive">{t("checkinUndoError")}</span> : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={undoCheckin.isPending}
              onClick={() => handleUndoOpenChange(false)}
            >
              {t("createEventCancel")}
            </Button>
            <Button type="button" disabled={undoCheckin.isPending} onClick={handleUndoConfirm}>
              {t("checkinUndoConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
