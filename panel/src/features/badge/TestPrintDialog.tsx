// P3.2 Task 6 -- the test-print dialog (board §4d's printer selector +
// "Print test badge" CTA). Prints ONE badge for the currently previewed
// attendee through the local agent, generated from the SAME live-doc inputs
// ZplPreviewModal.tsx uses (serializeTemplateDoc + preview.data,
// reconciliation #13) -- not a separately-derived snapshot. A small amount
// of duplication with that modal's generation effect is deliberate (per the
// task brief): this dialog is scoped to the editor's live doc, not the
// attendee-print flows Task 8's `usePrintBadge` will own.
//
// Deliberately does NOT bump `printed_count` on a successful send: a test
// print isn't an attendee's badge going out the door (it's a printer/label
// sanity check), AND this dialog never even receives an attendee id --
// only `previewData`/`previewName`, the same preview-attendee shape
// ZplPreviewModal consumes. Task 7's `markAttendeePrinted` endpoint is
// reserved for the drawer/bulk ATTENDEE print flows (P3.2 Tasks 8/9).
import {
  AgentStatus, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label,
} from "@idento/ui";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { agentClient } from "../../shared/agent/agentClient";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import type { BadgeConfig } from "./templateTypes";
import { rasterizeText, RasterUnavailableError } from "./zpl/canvasRasterizer";
import { generateZpl, type RawBadgeElement } from "./zpl/generateZpl";
import { collectMissingCustomFonts } from "./zpl/missingFonts";
import { useEventFontFaces } from "./zpl/useEventFontFaces";

export interface TestPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Same "RAW serialized template doc" contract as ZplPreviewModalProps.doc
  // -- only `.elements` is read here; width/height/dpi come from `config`.
  doc: Record<string, unknown>;
  config: BadgeConfig;
  previewData: Record<string, string>;
  previewName: string;
  eventId: string;
}

type Generation =
  | { status: "loading" }
  | { status: "ready"; zpl: string }
  | { status: "error"; message: string };

// Native <select>, styled to match PropertiesPane.tsx's own SELECT_CLASSNAME
// (duplicated per-file on purpose -- see that file's comment: there's no
// shared @idento/ui Select primitive yet).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function TestPrintDialog({
  open, onOpenChange, doc, config, previewData, previewName, eventId,
}: TestPrintDialogProps) {
  const { t } = useTranslation();
  const agent = useAgentPrinters(open);
  const fontFaces = useEventFontFaces(eventId, open);

  const docKey = JSON.stringify(doc);
  const dataKey = JSON.stringify(previewData);

  const elements = React.useMemo<RawBadgeElement[]>(
    () => (Array.isArray(doc.elements) ? (doc.elements as RawBadgeElement[]) : []),
    // Keyed off content (docKey), not identity -- see ZplPreviewModal.tsx's
    // own comment: `doc` is a freshly-built object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docKey],
  );

  const [generation, setGeneration] = React.useState<Generation>({ status: "loading" });

  React.useEffect(() => {
    if (!open) return;
    // Await font readiness before ever generating (reconciliation #9) --
    // same terminal-status gate ZplPreviewModal.tsx uses.
    if (fontFaces.status !== "ready" && fontFaces.status !== "error") {
      setGeneration({ status: "loading" });
      return;
    }

    let cancelled = false;
    setGeneration({ status: "loading" });

    // PR #74 review round Fix 8: checked BEFORE generation ever starts --
    // `fontFaces.status` is already terminal at this point (the guard
    // above), so `fontFaces.families` reflects the FINAL loaded set. A
    // customFont with no matching uploaded font must block the send here,
    // never silently reach generateZpl's raster branch (which would
    // substitute the browser's fallback font and rasterize a wrong-but-
    // legible bitmap with no error at all -- see missingFonts.ts).
    const missingFamilies = collectMissingCustomFonts(elements, fontFaces.families);
    if (missingFamilies.length > 0) {
      setGeneration({ status: "error", message: t("badgeTestPrintMissingFont", { families: missingFamilies.join(", ") }) });
      return;
    }

    async function run() {
      try {
        const zpl = await generateZpl(config, elements, previewData, { rasterizeText });
        if (!cancelled) setGeneration({ status: "ready", zpl });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof RasterUnavailableError
          ? t("badgeZplPreviewRasterError")
          : t("badgeTestPrintGenerateError");
        setGeneration({ status: "error", message });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fontFaces.status, docKey, dataKey, config.width_mm, config.height_mm, config.dpi]);

  // The printer <select>'s own selection. Re-derived from the hook's
  // web-parity default whenever the current selection is no longer a valid
  // choice (list changed underneath it, or nothing picked yet) -- but a
  // still-valid manual pick survives a background printers refetch.
  const [selectedPrinter, setSelectedPrinter] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (selectedPrinter && agent.printers.some((printer) => printer.name === selectedPrinter)) return;
    setSelectedPrinter(agent.defaultPrinter);
  }, [open, agent.defaultPrinter, agent.printers, selectedPrinter]);

  const [printing, setPrinting] = React.useState(false);
  const [printError, setPrintError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  // Session-ref cancel-race guard (AddAttendeeDialog.tsx pattern): bumped on
  // every close so a print that resolves/rejects AFTER the dialog session it
  // was started in has ended can never write its result into a later
  // session's state. Dismissal is also actively BLOCKED while printing (see
  // handleOpenChange/preventDialogDismiss below), so this is primarily
  // defense-in-depth for a parent forcing `open` closed directly -- same
  // rationale as that component's own comment.
  const sessionRef = React.useRef(0);

  React.useEffect(() => {
    if (open) return;
    sessionRef.current += 1;
    setPrinting(false);
    setPrintError(null);
    setSentTo(null);
    setSelectedPrinter(null);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && printing) return;
    onOpenChange(next);
  }

  function preventDialogDismiss(e: Event) {
    if (printing) e.preventDefault();
  }

  const agentStatusState = agent.state === "checking" ? "stale" : agent.state;
  const agentStatusTitleKey =
    agent.state === "connected"
      ? "badgeAgentStatusConnected"
      : agent.state === "checking"
        ? "badgeAgentStatusChecking"
        : "badgeAgentStatusDisconnected";
  const disconnected = agent.state === "disconnected";

  // Exhaustive busy-gating: reachability (must be connected, with a chosen
  // printer among a non-empty list), generation must have actually
  // succeeded (never send a stale/absent zpl), and never while a send is
  // already in flight.
  const sendDisabled =
    agent.state !== "connected"
    || !selectedPrinter
    || agent.printers.length === 0
    || generation.status !== "ready"
    || printing;

  async function handlePrint() {
    if (sendDisabled || generation.status !== "ready" || !selectedPrinter) return;
    const printerName = selectedPrinter;
    const zpl = generation.zpl;
    const mySession = sessionRef.current;
    setPrinting(true);
    setPrintError(null);
    setSentTo(null);
    try {
      await agentClient.print({ printer_name: printerName, zpl });
      if (mySession !== sessionRef.current) return;
      setSentTo(printerName);
      // Deliberately NO printed_count bump here: this is a TEST print, not
      // an attendee badge leaving the building -- and this dialog has no
      // attendee id to bump with anyway (only `previewData`/`previewName`).
      // Task 7's markAttendeePrinted endpoint is reserved for the drawer/
      // bulk ATTENDEE print flows (P3.2 Tasks 8/9), never this one.
    } catch (error) {
      if (mySession !== sessionRef.current) return;
      // The agent's error responses are plain text (agentClient.ts's own
      // comment) -- surface that text verbatim rather than a generic
      // message, same "error instanceof X ? error.message : fallback"
      // pattern ZonesPage.tsx/AddStaffDialog.tsx use for ApiError.
      setPrintError(error instanceof Error ? error.message : t("badgeTestPrintError"));
    } finally {
      if (mySession === sessionRef.current) setPrinting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        hideClose={printing}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader>
          <DialogTitle>{t("badgeTestPrintTitle")}</DialogTitle>
          <p className="text-caption text-muted-foreground">
            {t("badgeTestPrintFor", { name: previewName })}
          </p>
        </DialogHeader>

        <AgentStatus state={agentStatusState} title={t(agentStatusTitleKey)} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="test-print-printer">{t("printPrinterLabel")}</Label>
          <select
            id="test-print-printer"
            className={SELECT_CLASSNAME}
            value={selectedPrinter ?? ""}
            disabled={agent.state !== "connected" || agent.printers.length === 0 || printing}
            onChange={(event) => setSelectedPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </select>
        </div>

        {/* Same reconciliation #9 honesty as ZplPreviewModal.tsx: a fonts
            LIST/load failure doesn't block generation forever (native-only
            path still proceeds), but must stay visibly flagged -- a test
            print silently rasterizing fallback glyphs would defeat its own
            purpose. */}
        {fontFaces.status === "error" ? (
          <p className="text-body text-warning">{t("badgeFontsNotReady")}</p>
        ) : null}
        {generation.status === "error" ? (
          <p className="text-body text-destructive" role="alert">{generation.message}</p>
        ) : null}
        {printError ? <p className="text-body text-destructive" role="alert">{printError}</p> : null}
        {sentTo ? <p className="text-body text-success">{t("printSentTo", { printer: sentTo })}</p> : null}
        {/* Reachability-gated CTA idiom (spec §7.3): disabled, never a
            silent no-op, with a visible reason -- not just a hover-only
            tooltip (WCAG 1.4.1: this must be discoverable without relying
            on hover/color alone). */}
        {disconnected ? <p className="text-caption text-muted-foreground">{t("badgeAgentUnreachable")}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={printing} onClick={() => handleOpenChange(false)}>
            {t("createEventCancel")}
          </Button>
          <Button type="button" disabled={sendDisabled} onClick={() => void handlePrint()}>
            {t("badgeTestPrintSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
