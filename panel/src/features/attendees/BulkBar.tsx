import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle, Label, Select,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { exportAttendeesCsv } from "./exportCsv";
import { ATTENDEES_LIST_KEY, useEventZones } from "./hooks";
import { READINESS_KEY } from "../events/hooks";
import { MarkPrintedError, MissingFontError, NoTemplateError, usePrintBadge } from "../badge/zpl/usePrintBadge";
import { AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
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

  // Bulk print (P3.2 Task 9): built entirely on usePrintBadge (the same
  // generate -> agent print -> mark-printed -> invalidate flow the drawer's
  // Reprint button uses), sequentially over the page-scoped `selected` array.
  //
  // Reachability adjudication (task brief): unlike TestPrintDialog's
  // `useAgentPrinters(open)` (gated on ITS OWN dialog being open), this
  // mirrors AttendeeDrawer's `useAgentPrinters(true)` — enabled unconditionally
  // whenever BulkBar itself is mounted, not gated on the print dialog's own
  // open state. The OUTER "Print badges" button needs to know connectivity to
  // decide whether it's even clickable at all (same §7.3 reachability-gated
  // idiom as the drawer), and BulkBar only ever mounts when there's an active
  // selection — a selection already implies intent to act on it, so keeping
  // the connectivity probe enabled (one fetch on mount + a refetch on window
  // focus; the hook has NO polling interval) for as long as the bar is
  // visible is an acceptable cost — the same tradeoff the drawer already
  // makes.
  const agent = useAgentPrinters(true);
  const printBadge = usePrintBadge(eventId);

  const [printOpen, setPrintOpen] = React.useState(false);
  // Only meaningful (and only ever rendered) when the agent has NO configured
  // default printer — same inline <select> idiom as the drawer's Reprint
  // confirm.
  const [printerSelection, setPrinterSelection] = React.useState<string | null>(null);
  const [printing, setPrinting] = React.useState(false);
  const [printProgress, setPrintProgress] = React.useState<Progress | null>(null);
  // Genuine send/agent failures — counted separately from `printProgress.done`
  // (attempts), same attempt-vs-success honesty rule as assign/delete above.
  const [printFailedCount, setPrintFailedCount] = React.useState(0);
  // Soft counter: attendees whose SEND succeeded but whose printed-count bump
  // (MarkPrintedError) failed — counted as SENT, never as failed, but
  // surfaced as its own non-destructive warning line (never conflated with a
  // genuine send failure).
  const [printMarkWarnCount, setPrintMarkWarnCount] = React.useState(0);
  // PR #75 review finding: a timed-out send (AgentPrintTimeoutError) is NOT
  // a proven failure — the abort cancels only the client's wait; the agent
  // may have received the job, so the badge can still emerge. Counted as
  // neither sent nor failed: its own may-still-print warning line, so the
  // failed tally never invites re-running an attendee whose badge may
  // already be printing.
  const [printTimeoutCount, setPrintTimeoutCount] = React.useState(0);
  // No-template short-circuit: the loop stops at whichever attendee FIRST
  // observes a missing template — usePrintBadge re-fetches the template PER
  // printAttendee call (staleTime 0), so this can fire MID-batch (template
  // deleted in another tab while the batch is printing), not just on
  // attendee #1. A missing template fails identically for every remaining
  // attendee, so there's no point repeating the failure. Review fix
  // (Important): badges already sent before the short-circuit stay counted —
  // the readout below renders the partial tally ALONGSIDE the no-template
  // message, so an operator never mistakes "no template" for "nothing was
  // printed" and re-runs (double-prints) a partially-sent selection.
  const [printNoTemplate, setPrintNoTemplate] = React.useState(false);
  // PR #74 review round Fix 8: same short-circuit treatment as
  // `printNoTemplate` above -- a template referencing a customFont family no
  // uploaded font backs is EVENT-level (not attendee-specific), so it fails
  // identically for every remaining attendee. `families` (not just a
  // boolean) so the readout can name exactly which font(s) are missing.
  const [printMissingFontFamilies, setPrintMissingFontFamilies] = React.useState<string[] | null>(null);
  const printSessionRef = React.useRef(0);

  // Same "validated against the LIVE printer list" rule as the drawer's
  // `reprintConfiguredDefault` — the agent's configured default can name a
  // printer that's since been unplugged/removed.
  const printConfiguredDefault =
    agent.configuredDefault && agent.printers.some((printer) => printer.name === agent.configuredDefault)
      ? agent.configuredDefault
      : null;

  React.useEffect(() => {
    if (!printOpen) return;
    if (printConfiguredDefault) return;
    if (printerSelection && agent.printers.some((printer) => printer.name === printerSelection)) return;
    setPrinterSelection(agent.defaultPrinter);
  }, [printOpen, printConfiguredDefault, agent.defaultPrinter, agent.printers, printerSelection]);

  const printTargetPrinter = printConfiguredDefault ?? printerSelection;
  const printAgentDisconnected = agent.state === "disconnected";
  // Reconciliation #9 (fonts must be awaited before generation): checked/
  // awaited ONCE before the loop starts (the hook's own per-call await inside
  // `printAttendee` makes every subsequent call in the batch cheap once this
  // has settled) — gating the confirm button on it means the operator never
  // sees the batch silently "hang" on the first attendee waiting on a fonts
  // fetch that just hasn't settled yet.
  const printFontsBlocking = printBadge.fontsStatus !== "ready" && printBadge.fontsStatus !== "error";

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
      // Readiness too: every deleted attendee changes the live count the
      // backend recomputes the rail's attendees step from — same
      // cache-correctness rationale as the list invalidation above, so it
      // also runs regardless of the session check below.
      await queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: READINESS_KEY(eventId) });
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

  function handlePrintOpenChange(open: boolean) {
    if (!open) {
      // Exhaustive busy-gating, same as assign/delete above — but with a
      // sharper rationale here: a cancelled/failed-looking print may still
      // emerge from the printer (the agent's `/print` response is a
      // TRANSPORT ack only, never a print confirmation — see agentClient.ts).
      // Aborting mid-batch wouldn't just leave an unclear split of "printed
      // vs not", it could leave PHYSICAL badges coming out of the printer
      // with no record of which attendees they belonged to. The loop is
      // deliberately not abortable in v1 — dismissal stays blocked until it
      // settles on its own.
      if (printing) return;
      printSessionRef.current += 1;
      setPrintProgress(null);
      setPrintFailedCount(0);
      setPrintMarkWarnCount(0);
      setPrintTimeoutCount(0);
      setPrintNoTemplate(false);
      setPrintMissingFontFamilies(null);
      setPrinterSelection(null);
    }
    setPrintOpen(open);
  }

  async function handleConfirmPrintBadges() {
    const printerName = printTargetPrinter;
    if (!printerName) return;
    const sessionId = printSessionRef.current;
    const total = selected.length;
    setPrinting(true);
    setPrintProgress({ done: 0, total });
    setPrintFailedCount(0);
    setPrintMarkWarnCount(0);
    setPrintTimeoutCount(0);
    setPrintNoTemplate(false);
    setPrintMissingFontFamilies(null);
    let attemptedAny = false;
    let failedCount = 0;
    let markWarnCount = 0;
    let timeoutCount = 0;
    let noTemplate = false;
    let missingFontFamilies: string[] | null = null;

    for (let i = 0; i < selected.length; i++) {
      // Unreachable via the UI while `printing` blocks dismissal above —
      // kept as defense-in-depth, same as assign/delete's own loops.
      if (printSessionRef.current !== sessionId) break;
      try {
        // `skipInvalidate: true` -- this batch invalidates ATTENDEES_LIST_KEY
        // exactly ONCE after the whole loop below, instead of once per
        // attendee (cheap dedupe over a page-scoped, <=50-attendee
        // selection). Detail keys are deliberately skipped entirely in bulk
        // (never invalidated here, unlike the drawer's single-print path) --
        // the table view is what refreshes after a bulk action, and no
        // single attendee's detail drawer is open during a multi-select
        // batch print.
        await printBadge.printAttendee(selected[i], printerName, { skipInvalidate: true });
        attemptedAny = true;
      } catch (error) {
        if (error instanceof NoTemplateError) {
          // Pre-send failure: the event has no saved template (either from
          // the start, or deleted mid-batch -- printAttendee re-fetches the
          // template per call), so every remaining attendee would fail in
          // exactly the same way. Short-circuit the whole loop rather than
          // repeating the identical failure (and identical progress-readout
          // churn) for the rest of the selection. Progress deliberately NOT
          // bumped for this attendee -- nothing was sent for them -- so
          // `printProgress.done` keeps the honest count of completed
          // attempts for the partial-tally readout below.
          noTemplate = true;
          break;
        }
        // PR #74 review round Fix 8: same pre-send, whole-batch short-
        // circuit as NoTemplateError above -- a missing customFont is a
        // property of the TEMPLATE (event-level), not this attendee, so it
        // fails identically for every remaining one too. Progress
        // deliberately NOT bumped for this attendee, same rationale.
        if (error instanceof MissingFontError) {
          missingFontFamilies = error.families;
          break;
        }
        attemptedAny = true;
        if (error instanceof MarkPrintedError) {
          // The SEND succeeded -- counted as sent, never as failed, but
          // flagged via the soft warning counter below.
          markWarnCount += 1;
        } else if (error instanceof AgentPrintTimeoutError) {
          // Unconfirmed, not failed: the badge may still emerge (see the
          // counter's doc comment above) -- never folded into failedCount.
          timeoutCount += 1;
        } else {
          failedCount += 1;
        }
      }
      if (printSessionRef.current === sessionId) {
        setPrintProgress({ done: i + 1, total });
        setPrintFailedCount(failedCount);
        setPrintMarkWarnCount(markWarnCount);
        setPrintTimeoutCount(timeoutCount);
      }
    }

    if (attemptedAny) {
      // Cache correctness: at least one send genuinely reached the agent
      // (and possibly the server-side printed-count bump), so this runs
      // unconditionally -- same rationale as assign/delete above. Skipped
      // entirely when `noTemplate` short-circuited on the very first
      // attendee: nothing was ever attempted, so there's nothing to refresh.
      await queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
    }
    if (printSessionRef.current !== sessionId) return;
    setPrinting(false);
    if (noTemplate) setPrintNoTemplate(true);
    if (missingFontFamilies) setPrintMissingFontFamilies(missingFontFamilies);
    // Deliberately does not auto-close on completion (matches Assign zone's
    // convention, not Delete's) -- the final honest tally (sent vs failed,
    // plus the soft mark-warn line) is the confirmation the operator reads
    // before closing it themselves.
  }

  const zones = (zonesQuery.data ?? []).map(zoneIdentity);
  const count = selected.length;

  // Once the batch has settled (no longer printing) with at least one
  // genuine failure, the readout switches from the plain "x of y sent" copy
  // to the honest with-failures breakdown -- same idiom as
  // bulkAssignZoneDoneWithFailures above. Suppressed while `printNoTemplate`
  // is set -- the loop never ran to completion, so a completion-shaped
  // "x of y sent" tally would misrepresent a batch that stopped early; the
  // dedicated partial-tally branch below (rendered alongside the
  // no-template message) reports whatever WAS sent instead. Same suppression
  // for `printMissingFontFamilies` (PR #74 review round Fix 8) -- an
  // event-level short-circuit exactly like `printNoTemplate`, so it gets the
  // SAME "don't show the completion-shaped tally" treatment.
  // `sent` excludes timeouts as well as failures (PR #75 review finding):
  // a timed-out send was never confirmed, so claiming it as "sent" would be
  // as dishonest as calling it failed — it gets its own warning line below.
  const printDoneReadout = !printing && printProgress && !printNoTemplate && !printMissingFontFamilies ? (
    printFailedCount > 0
      ? t("bulkPrintDoneWithFailures", {
          sent: printProgress.total - printFailedCount - printTimeoutCount,
          total: printProgress.total,
          failed: printFailedCount,
        })
      : t("bulkPrintDone", {
          sent: printProgress.total - printFailedCount - printTimeoutCount,
          total: printProgress.total,
        })
  ) : null;

  const printDescription = (
    <>
      {printNoTemplate ? (
        printProgress && printProgress.done > 0 ? (
          <span className="block">
            {/* Review fix (Important): the template can vanish MID-batch
                (per-call re-fetch), after real badges have already been
                sent. Hiding those sends behind the no-template message alone
                would invite the operator to re-run the same selection after
                restoring the template and double-print them -- the partial
                tally stays visible, stacked above the error. `done` counts
                completed attempts (the short-circuited attendee never bumps
                it); genuine failures among them are subtracted, so `sent`
                is only ever badges that actually went out. Follow-up batch
                item 5: with failures in the mix, the plain tally leaves the
                remainder ambiguous (failed? never reached?), so the
                with-failures variant splits failed (attempted, send
                rejected) from never-attempted (loop stopped first:
                total - done, which includes the short-circuited attendee). */}
            {printFailedCount > 0
              ? t("bulkPrintPartialBeforeNoTemplateWithFailures", {
                  sent: printProgress.done - printFailedCount - printTimeoutCount,
                  total: printProgress.total,
                  failed: printFailedCount,
                  notAttempted: printProgress.total - printProgress.done,
                })
              : t("bulkPrintPartialBeforeNoTemplate", {
                  sent: printProgress.done - printFailedCount - printTimeoutCount,
                  total: printProgress.total,
                })}
          </span>
        ) : null
      ) : printMissingFontFamilies ? (
        // PR #74 review round Fix 8: same partial-tally-stays-visible
        // treatment as the no-template branch above -- badges already sent
        // before a missing-font short-circuit must not be hidden behind the
        // error, or an operator could re-run the selection and double-print
        // them once the template is fixed.
        printProgress && printProgress.done > 0 ? (
          <span className="block">
            {t("bulkPrintPartialBeforeMissingFont", {
              sent: printProgress.done - printFailedCount - printTimeoutCount,
              total: printProgress.total,
            })}
          </span>
        ) : null
      ) : printTargetPrinter ? (
        <span className="block">
          {printing && printProgress
            ? t("bulkPrintProgress", { done: printProgress.done, total: printProgress.total })
            : printDoneReadout ?? t("bulkPrintSummary", { count, printer: printTargetPrinter })}
        </span>
      ) : null}
      {!printConfiguredDefault ? (
        <span className="mt-2 flex flex-col gap-2">
          <Label htmlFor="bulk-print-printer">{t("printPrinterLabel")}</Label>
          <Select
            id="bulk-print-printer"
            value={printerSelection ?? ""}
            disabled={agent.printers.length === 0 || printing}
            onChange={(event) => setPrinterSelection(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </Select>
        </span>
      ) : null}
      {printing ? (
        // Follow-up batch item 4: every dismiss path is inert while the
        // batch runs (see handlePrintOpenChange), but the shared
        // ConfirmDialog's Cancel button still LOOKS clickable — without
        // this line a click on it reads as a broken button, or worse, as a
        // successful cancel. Transport-ack truth: a send can't be recalled.
        <span className="mt-2 block">{t("bulkPrintNoCancelHint")}</span>
      ) : null}
      {printBadge.fontsStatus === "error" ? (
        <span className="mt-2 block text-warning">{t("badgeFontsNotReady")}</span>
      ) : null}
      {!printing && printMarkWarnCount > 0 ? (
        <span className="mt-2 block text-warning">{t("bulkPrintMarkWarn", { count: printMarkWarnCount })}</span>
      ) : null}
      {!printing && printTimeoutCount > 0 ? (
        <span className="mt-2 block text-warning">{t("bulkPrintTimeoutWarn", { count: printTimeoutCount })}</span>
      ) : null}
      {printNoTemplate ? (
        <span className="mt-2 block text-destructive">
          {/* Follow-up batch item 5: with done > 0 the event demonstrably
              HAD a template (badges were generated from it this batch), so
              "doesn't have a badge template YET" would misread — the
              softened became-unavailable copy shows instead. done === 0
              keeps the original copy: nothing was ever generated, so
              "no template yet" is the honest description. */}
          {printProgress && printProgress.done > 0 ? t("bulkPrintTemplateGone") : t("bulkPrintNoTemplate")}
        </span>
      ) : null}
      {printMissingFontFamilies ? (
        <span className="mt-2 block text-destructive">
          {t("bulkPrintMissingFont", { families: printMissingFontFamilies.join(", ") })}
        </span>
      ) : null}
    </>
  );

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
          {/* Live now (P3.2 Task 9) — the badge editor exists, so the OLD
              permanent lock is retired. Reachability-gated instead (spec
              §7.3 idiom, same as the drawer's Reprint button): disabled +
              a native `title` tooltip whenever the agent isn't connected,
              never a silent no-op. No Lock icon here — that idiom is
              reserved for features that don't exist yet; this one exists,
              it's just temporarily unreachable. */}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-caption text-background/70 hover:text-background hover:no-underline"
            disabled={agent.state !== "connected" || printing}
            aria-disabled={agent.state !== "connected" || printing}
            title={printAgentDisconnected ? t("bulkPrintUnreachable") : undefined}
            onClick={() => {
              setPrintNoTemplate(false);
              setPrintOpen(true);
            }}
          >
            {t("bulkPrint")}
          </Button>
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

      <ConfirmDialog
        open={printOpen}
        onOpenChange={handlePrintOpenChange}
        title={t("bulkPrintConfirmTitle")}
        description={printDescription}
        confirmLabel={t("bulkPrintConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        // `printProgress !== null` (not just `printing`): once a batch has
        // SETTLED on its final tally, confirm must not silently re-enable —
        // a second click would re-run the whole batch over the same
        // selection (double print). A settled session is closed with the
        // dialog (handlePrintOpenChange resets printProgress); re-running
        // requires an explicit close + reopen.
        confirmDisabled={
          printing || printProgress !== null || !printTargetPrinter
          || agent.state !== "connected" || printFontsBlocking
        }
        onConfirm={() => void handleConfirmPrintBadges()}
      />
    </>
  );
}
