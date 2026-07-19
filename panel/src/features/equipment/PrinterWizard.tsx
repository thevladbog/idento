// P4.3 Task 8 -- the printer setup wizard (board 5b): Find -> Test -> Save
// with physical verification, plus a RETEST entry point (controller-
// resolved plan addition, task-8-brief.md's "CONTROLLER-RESOLVED PLAN
// ADDITION") for a saved row's board-drawn "Test print" button
// (spec §4.2/§5.2 gap Task 7's hub deferred).
//
// Navigation model -- a deliberate, brief-consistent resolution of an
// underspecified board footer (board 5b's static mock shows the Test
// step's 3 verification buttons AND a "← Back / Save printer" footer in
// the SAME screenshot): Find is its own screen; Test and Save share ONE
// footer ("← Back" / "Save printer") once past Find, with the body above
// it switching between the test-verification block (step "test") and the
// display-name/default-checkbox form (step "save"). "Save printer" is
// therefore reachable -- and submits with whatever `testPassed` currently
// holds -- from EITHER body, which is what makes "save without a
// confirmed test sends test_passed: false" (task-8-brief.md's test
// matrix) possible: the operator can click it straight off the Test
// screen without ever clicking "Yes, looks right". "Yes, looks right"
// both sets testPassed AND advances the step indicator to "save"
// (revealing the name/checkbox form) -- it does not gate Save itself.
//
// Retest mode has no Find/Save at all (task-8-brief.md's controller
// addition): it opens straight at Test for an EXISTING device, and "Yes,
// looks right" calls the existing useMarkTestPassed(machineId) mutation
// directly instead of creating a new registry row.
import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useCreateDevice, useMarkTestPassed } from "./hooks";
import { buildTestLabelZpl } from "./testLabel";
import { agentClient, AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { AGENT_PRINTERS_KEY, useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import type { AgentPrinter } from "../../shared/agent/agentClient";

export interface PrinterWizardPrefill {
  agentName: string;
  type: "system" | "network";
}

export interface PrinterWizardRetest {
  deviceId: string;
  agentName: string;
  displayName: string;
  // Review fix round Minor 6: the saved device's real kind (was hardcoded
  // "system"). Unread by retest mode's current flow (no Save path), but a
  // future retest extension must never inherit a silently wrong kind.
  kind: "system" | "network";
}

export interface PrinterWizardProps {
  open: boolean;
  onClose: () => void;
  // The machine this printer is being registered under (Task 6's
  // useCreateDevice/useMarkTestPassed both take it as a hook-level arg,
  // not a mutate()-call variable -- see hooks.ts's own comment on why).
  // Callers (EquipmentPage) only ever open this wizard once machineId is
  // known -- see that file's own guard.
  machineId: string;
  // Set by the hub's unsaved-live-printer row ("Save…", prefilled) --
  // skips straight to Test with this printer already selected.
  prefill?: PrinterWizardPrefill;
  // Set by a saved row's "Test print" button -- retest mode (see module
  // comment above).
  retest?: PrinterWizardRetest;
  // Review fix round Minor 5: agent names of printers ALREADY registered
  // on this machine -- excluded from the Find list so an operator can't
  // re-pick one and create a duplicate registry row for the same physical
  // printer (the hub's own unsaved-rows section already filters this way
  // via reconcile.ts's unsavedLivePrinters; the wizard's internal list
  // must match).
  registeredAgentNames?: string[];
}

type Step = "find" | "test" | "save";

interface Selected {
  agentName: string;
  type: "system" | "network";
  // Only ever populated by the manual "Enter IP manually" path -- GET
  // /printers (agent/openapi.yaml's PrinterEntry) reports name+type only,
  // no ip/port, so a printer picked directly off the Find list (or handed
  // in via `prefill`) never carries these. A network-kind save without
  // them will be rejected by the registry's own validation (config.ip/
  // config.port required for kind=network) -- an honest failure surfaced
  // via `saveError`, not a silent data loss, and out of this wizard's
  // reach to fix (the agent's own contract has no ip/port lookup for an
  // already-added network printer).
  ip?: string;
  port?: number;
}

const DEFAULT_MANUAL_PORT = "9100";

export function PrinterWizard({ open, onClose, machineId, prefill, retest, registeredAgentNames = [] }: PrinterWizardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const agent = useAgentPrinters(open);
  const createDevice = useCreateDevice(machineId);
  const markTestPassed = useMarkTestPassed(machineId);

  const isRetest = retest != null;

  const [step, setStep] = React.useState<Step>("find");
  const [selected, setSelected] = React.useState<Selected | null>(null);
  const [testPassed, setTestPassed] = React.useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [makeDefault, setMakeDefault] = React.useState(true);

  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualName, setManualName] = React.useState("");
  const [manualIp, setManualIp] = React.useState("");
  const [manualPort, setManualPort] = React.useState(DEFAULT_MANUAL_PORT);
  const [manualSubmitting, setManualSubmitting] = React.useState(false);
  const [manualError, setManualError] = React.useState<string | null>(null);

  // Review fix round Important 2: the Save step's own ip/port form for a
  // network-typed printer whose address the wizard doesn't know (picked
  // off the Find list or handed in via prefill -- GET /printers reports
  // {name, type} only, and the registry hard-requires config.ip/port for
  // kind=network, so saving without them was a guaranteed-400 dead end).
  // Deliberately separate state from the Find step's manual-add form: the
  // two forms are mutually exclusive per session (a manually-added printer
  // always carries its address in `selected`), but sharing state would let
  // an abandoned half-typed manual form leak into the Save step.
  const [saveIp, setSaveIp] = React.useState("");
  const [savePort, setSavePort] = React.useState(DEFAULT_MANUAL_PORT);

  const [printing, setPrinting] = React.useState(false);
  const [printError, setPrintError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [mirrorWarning, setMirrorWarning] = React.useState(false);

  // Session-ref cancel-race guard (TestPrintDialog.tsx/AddAttendeeDialog
  // pattern): bumped every time the dialog opens/closes so a print/save
  // that resolves AFTER this session ended never writes into a later
  // session's state.
  const sessionRef = React.useRef(0);
  // Guards the Test step's auto-fired print to exactly ONE per selected
  // printer (task-8-brief.md: "mount fires ONE print") -- re-rendering
  // while parked on Test for the SAME selection never refires; only a
  // genuinely different `selected.agentName` (a fresh session) does.
  const firedForRef = React.useRef<string | null>(null);

  // Seeds (or resets) the whole session whenever the dialog opens/closes
  // or its target changes -- same "everything resets on close" shape as
  // TestPrintDialog.tsx's own open-keyed effect.
  React.useEffect(() => {
    sessionRef.current += 1;
    if (!open) return;
    firedForRef.current = null;
    setPrinting(false);
    setPrintError(null);
    setSentTo(null);
    setSaving(false);
    setSaveError(null);
    setMirrorWarning(false);
    setShowTroubleshoot(false);
    setManualOpen(false);
    setManualName("");
    setManualIp("");
    setManualPort(DEFAULT_MANUAL_PORT);
    setManualError(null);
    setSaveIp("");
    setSavePort(DEFAULT_MANUAL_PORT);
    setTestPassed(false);
    setMakeDefault(true);

    if (retest) {
      setStep("test");
      setSelected({ agentName: retest.agentName, type: retest.kind });
      setDisplayName(retest.displayName);
      return;
    }
    if (prefill) {
      setStep("test");
      setSelected({ agentName: prefill.agentName, type: prefill.type });
      setDisplayName(prefill.agentName);
      return;
    }
    setStep("find");
    setSelected(null);
    setDisplayName("");
    // Deliberately keyed on `open` + the retest/prefill TARGET identity
    // only -- must not re-run just because a parent re-renders with a
    // new-but-equal prefill/retest object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, retest?.deviceId, prefill?.agentName]);

  const runPrint = React.useCallback(
    (printerName: string) => {
      const mySession = sessionRef.current;
      setPrinting(true);
      setPrintError(null);
      setSentTo(null);
      void agentClient
        .print({ printer_name: printerName, zpl: buildTestLabelZpl(printerName) })
        .then(() => {
          if (mySession !== sessionRef.current) return;
          setSentTo(printerName);
        })
        .catch((error: unknown) => {
          if (mySession !== sessionRef.current) return;
          // A timed-out send is NOT a proven failure -- the abort only
          // cancelled OUR wait; the agent may have received the job and
          // the label may still emerge (agentClient.ts's own warning).
          // Same transport-ack honesty as TestPrintDialog.tsx's
          // printAgentTimeout, but with its OWN key (review fix round
          // Minor 7): the shared copy says "the badge may still print",
          // and this wizard prints a test LABEL, not a badge -- the badge
          // wording would sit right next to equipmentWizardSent's "check
          // the label" and contradict it.
          if (error instanceof AgentPrintTimeoutError) {
            setPrintError(t("equipmentWizardTimeout"));
            return;
          }
          setPrintError(error instanceof Error ? error.message : t("equipmentWizardTestGenericError"));
        })
        .finally(() => {
          if (mySession === sessionRef.current) setPrinting(false);
        });
    },
    [t],
  );

  // Auto-fire exactly once per selected printer whenever the Test step is
  // showing (task-8-brief.md: "Test step: mount fires ONE print").
  React.useEffect(() => {
    if (!open || step !== "test" || !selected) return;
    if (firedForRef.current === selected.agentName) return;
    firedForRef.current = selected.agentName;
    runPrint(selected.agentName);
  }, [open, step, selected, runPrint]);

  function pickPrinter(printer: AgentPrinter) {
    setSelected({ agentName: printer.name, type: printer.type });
    setDisplayName(printer.name);
    setStep("test");
  }

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Review fix round Minor 3: re-checked INSIDE the handler, not just via
    // the submit button's `disabled` prop -- TestPrintDialog.tsx's
    // handlePrint defense-in-depth idiom (a rapid double-submit must never
    // fire two /printers/add POSTs).
    if (manualSubmitting) return;
    const trimmedName = manualName.trim();
    const trimmedIp = manualIp.trim();
    const port = Number(manualPort);
    if (!trimmedName || !trimmedIp || !Number.isFinite(port)) return;
    setManualSubmitting(true);
    setManualError(null);
    try {
      await agentClient.addNetworkPrinter({ name: trimmedName, ip: trimmedIp, port });
      // Any OTHER mounted useAgentPrinters consumer (the hub's own
      // unsaved-row list, TestPrintDialog, BulkBar, ...) shares this same
      // query key/cache -- refresh it so the newly-added printer shows up
      // there too, not just in this wizard's own local `selected`.
      void queryClient.invalidateQueries({ queryKey: AGENT_PRINTERS_KEY });
      setSelected({ agentName: trimmedName, type: "network", ip: trimmedIp, port });
      setDisplayName(trimmedName);
      setStep("test");
    } catch (error) {
      setManualError(error instanceof Error ? error.message : t("equipmentWizardManualError"));
    } finally {
      setManualSubmitting(false);
    }
  }

  function handlePrintAgain() {
    if (!selected) return;
    runPrint(selected.agentName);
  }

  function handleTestOff() {
    setShowTroubleshoot(true);
  }

  async function handleRetestConfirm() {
    // Same Minor-3 defense-in-depth re-check as handleManualSubmit above.
    if (!retest || saving) return;
    const mySession = sessionRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      await markTestPassed.mutateAsync({ params: { path: { device_id: retest.deviceId } } });
      if (mySession !== sessionRef.current) return;
      onClose();
    } catch (error) {
      if (mySession !== sessionRef.current) return;
      setSaveError(error instanceof Error ? error.message : t("equipmentWizardSaveGenericError"));
    } finally {
      if (mySession === sessionRef.current) setSaving(false);
    }
  }

  function handleTestYes() {
    setTestPassed(true);
    if (isRetest) {
      void handleRetestConfirm();
      return;
    }
    setStep("save");
  }

  function goBack() {
    if (step === "save") {
      setStep("test");
      return;
    }
    if (step === "test" && !isRetest) {
      setStep("find");
      setSelected(null);
      setDisplayName("");
      firedForRef.current = null;
      setPrinting(false);
      setPrintError(null);
      setSentTo(null);
      setShowTroubleshoot(false);
    }
  }

  // Review fix round Important 2: a network-typed printer whose address the
  // wizard doesn't know (Find-list pick / unsaved-row prefill) must collect
  // ip/port at the Save step -- the operator configured the printer, so
  // they know its address even though GET /printers can't report it.
  const trimmedSaveIp = saveIp.trim();
  const savePortNumber = Number(savePort);
  const needsAddress = selected?.type === "network" && (selected.ip === undefined || selected.port === undefined);
  const addressValid =
    trimmedSaveIp.length > 0 && Number.isInteger(savePortNumber) && savePortNumber >= 1 && savePortNumber <= 65535;

  async function handleSaveClick() {
    // Same Minor-3 defense-in-depth re-check as handleManualSubmit above.
    if (!selected || isRetest || saving) return;
    // Important-2: the shared Test/Save footer makes "Save printer"
    // reachable straight from the Test step -- for an address-less network
    // printer that click must LAND ON the address form, never fire a
    // create the backend is guaranteed to 400.
    if (needsAddress && step !== "save") {
      setStep("save");
      return;
    }
    if (needsAddress && !addressValid) return;
    const mySession = sessionRef.current;
    setSaving(true);
    setSaveError(null);
    setMirrorWarning(false);
    try {
      const config: Record<string, unknown> = { agent_name: selected.agentName };
      if (selected.type === "network") {
        config.ip = selected.ip ?? trimmedSaveIp;
        config.port = selected.port ?? savePortNumber;
      }
      await createDevice.mutateAsync({
        params: { path: { machine_id: machineId } },
        body: {
          class: "printer",
          kind: selected.type,
          display_name: displayName.trim() || selected.agentName,
          config,
          make_default: makeDefault,
          test_passed: testPassed,
        },
      });
      if (mySession !== sessionRef.current) return;
      if (makeDefault) {
        try {
          await agentClient.setDefaultPrinter(selected.agentName);
        } catch {
          if (mySession !== sessionRef.current) return;
          // Server rule already saved -- the registry's make_default
          // write above is the source of truth (spec §5.3
          // "server-wins"); the agent's own /printers/default config is
          // only a convenience MIRROR of that rule so an agent-local
          // caller sees the same default too. A mirror failure must
          // never fail the save itself; it re-converges on the next hub
          // load's reconcile.
          //
          // Review fix round Important 1: do NOT close here. Warning +
          // onClose() in one synchronous tick meant the warning never
          // painted (React 18 batches both setStates into one commit and
          // the unanimated Radix DialogContent unmounts pre-paint) -- the
          // operator never learned the mirror failed. House convention
          // (BulkBar.tsx): the dialog stays open, the warning is the
          // confirmation the operator reads, and THEY dismiss it (the
          // footer swaps to an explicit Close -- see below -- which also
          // removes the Save button so the already-committed create can't
          // be re-fired).
          setMirrorWarning(true);
          return;
        }
      }
      if (mySession !== sessionRef.current) return;
      onClose();
    } catch (error) {
      if (mySession !== sessionRef.current) return;
      setSaveError(error instanceof Error ? error.message : t("equipmentWizardSaveGenericError"));
    } finally {
      if (mySession === sessionRef.current) setSaving(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && (printing || saving || manualSubmitting)) return;
    if (!next) onClose();
  }

  // Review fix round Minor 4: covers manualSubmitting too, consistently
  // with handleOpenChange above and hideClose below -- a ✕ that stays
  // visible-but-inert during the /printers/add POST would look like a
  // broken control (the exact concern BulkBar.tsx's no-cancel hint calls
  // out).
  function preventDialogDismiss(e: Event) {
    if (printing || saving || manualSubmitting) e.preventDefault();
  }

  const agentStatusLabel =
    agent.state === "connected" ? null : agent.state === "checking" ? t("badgeAgentStatusChecking") : t("badgeAgentUnreachable");

  // Review fix round Minor 5: the Find list must not offer printers that
  // already have a registry row on this machine (matched by the stable
  // agent-side name, never display_name -- reconcile.ts's rule); re-picking
  // one would create a duplicate device for the same physical printer.
  const registeredNames = new Set(registeredAgentNames);
  const findPrinters = agent.printers.filter((printer) => !registeredNames.has(printer.name));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        // mirrorWarning also hides the ✕: the footer's explicit Close (the
        // Important-1 dismiss affordance) is the single close control in
        // that state, rather than two same-named "Close" buttons.
        hideClose={printing || saving || manualSubmitting || mirrorWarning}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader>
          <DialogTitle>{isRetest ? t("equipmentWizardRetestTitle") : t("equipmentWizardPrinterTitle")}</DialogTitle>
          {isRetest && retest ? (
            <p className="text-caption text-muted-foreground">{t("equipmentWizardRetestFor", { name: retest.displayName })}</p>
          ) : (
            <div className="flex items-center gap-2 text-caption text-muted-foreground" data-testid="equipment-wizard-steps">
              <span className={cn((step === "test" || step === "save") && "text-success")}>
                {step === "find" ? "1" : "✓"} {t("equipmentWizardFind")}
              </span>
              <span aria-hidden>—</span>
              <span className={cn(step === "save" && "text-success")}>
                {step === "save" ? "✓" : "2"} {t("equipmentWizardTest")}
              </span>
              <span aria-hidden>—</span>
              <span>3 {t("equipmentWizardSave")}</span>
            </div>
          )}
        </DialogHeader>

        {step === "find" ? (
          <div className="flex flex-col gap-3">
            {agentStatusLabel ? (
              <p
                className={cn("text-body", agent.state === "disconnected" ? "text-destructive" : "text-muted-foreground")}
                role={agent.state === "disconnected" ? "alert" : undefined}
              >
                {agentStatusLabel}
              </p>
            ) : findPrinters.length === 0 ? (
              <p className="text-body text-muted-foreground">{t("printNoPrinters")}</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="equipment-wizard-find-list">
                {findPrinters.map((printer) => (
                  <li key={printer.name}>
                    <button
                      type="button"
                      onClick={() => pickPrinter(printer)}
                      className="flex w-full items-center justify-between rounded-md border border-success bg-success/5 px-3 py-2 text-left hover:bg-success/10"
                    >
                      <span className="font-bold text-foreground">{printer.name}</span>
                      <span className="font-mono text-caption text-muted-foreground">{printer.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!manualOpen ? (
              <button
                type="button"
                className="self-end text-caption text-success underline underline-offset-2"
                onClick={() => setManualOpen(true)}
              >
                {t("equipmentWizardManualIp")}
              </button>
            ) : (
              <form className="flex flex-col gap-3 rounded-md border border-border p-3" onSubmit={(e) => void handleManualSubmit(e)}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="printer-wizard-manual-name">{t("equipmentWizardManualName")}</Label>
                  <Input
                    id="printer-wizard-manual-name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    disabled={manualSubmitting}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="printer-wizard-manual-ip">{t("equipmentWizardManualIpAddress")}</Label>
                  <Input
                    id="printer-wizard-manual-ip"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    disabled={manualSubmitting}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="printer-wizard-manual-port">{t("equipmentWizardManualPort")}</Label>
                  <Input
                    id="printer-wizard-manual-port"
                    type="number"
                    value={manualPort}
                    onChange={(e) => setManualPort(e.target.value)}
                    disabled={manualSubmitting}
                  />
                </div>
                {manualError ? (
                  <p role="alert" className="text-body text-destructive">
                    {manualError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" disabled={manualSubmitting} onClick={() => setManualOpen(false)}>
                    {t("createEventCancel")}
                  </Button>
                  <Button type="submit" disabled={manualSubmitting || !manualName.trim() || !manualIp.trim()}>
                    {t("settingsSave")}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <>
            {step === "test" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div
                  className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 font-mono text-caption text-muted-foreground"
                  data-testid="equipment-wizard-test-preview"
                  aria-hidden
                >
                  test label
                </div>
                <div className="flex flex-col gap-3">
                  <p className="text-card-title font-bold text-foreground">{t("equipmentWizardTestQuestion")}</p>
                  <p className="text-body text-muted-foreground">{t("equipmentWizardTestHint")}</p>
                  {printError ? (
                    <p role="alert" className="text-body text-destructive">
                      {printError}
                    </p>
                  ) : null}
                  {sentTo ? <p className="text-body text-success">{t("equipmentWizardSent", { printer: sentTo })}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={saving} onClick={handleTestYes}>
                      {t("equipmentWizardTestYes")}
                    </Button>
                    <Button type="button" variant="outline" disabled={printing || !selected} onClick={handlePrintAgain}>
                      {t("equipmentWizardTestAgain")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-warning text-warning"
                      onClick={handleTestOff}
                    >
                      {t("equipmentWizardTestOff")}
                    </Button>
                  </div>
                  {showTroubleshoot ? (
                    <p className="text-body text-muted-foreground" data-testid="equipment-wizard-troubleshoot">
                      {t("equipmentWizardTroubleshoot")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="printer-wizard-name">{t("equipmentWizardManualName")}</Label>
                  <Input
                    id="printer-wizard-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={saving || mirrorWarning}
                  />
                </div>
                {needsAddress ? (
                  // Important-2: the registry hard-requires config.ip/port
                  // for kind=network, and this printer's address isn't
                  // knowable from GET /printers -- collect it here. Save
                  // stays disabled until the address is valid (see the
                  // footer's disabled expression).
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="printer-wizard-save-ip">{t("equipmentWizardManualIpAddress")}</Label>
                      <Input
                        id="printer-wizard-save-ip"
                        value={saveIp}
                        onChange={(e) => setSaveIp(e.target.value)}
                        disabled={saving || mirrorWarning}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="printer-wizard-save-port">{t("equipmentWizardManualPort")}</Label>
                      <Input
                        id="printer-wizard-save-port"
                        type="number"
                        value={savePort}
                        onChange={(e) => setSavePort(e.target.value)}
                        disabled={saving || mirrorWarning}
                      />
                    </div>
                  </div>
                ) : null}
                <label className="flex items-center gap-2 text-body text-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded-[4px] border-[1.5px] border-input accent-success"
                    checked={makeDefault}
                    onChange={(e) => setMakeDefault(e.target.checked)}
                    disabled={saving || mirrorWarning}
                  />
                  {t("equipmentWizardDefaultCheckbox")}
                </label>
              </div>
            )}

            {mirrorWarning ? (
              <p className="text-body text-warning" role="status">
                {t("equipmentWizardMirrorWarn")}
              </p>
            ) : null}
            {saveError ? (
              <p role="alert" className="text-body text-destructive">
                {saveError}
              </p>
            ) : null}

            {!isRetest ? (
              <DialogFooter>
                {mirrorWarning ? (
                  // Important-1: the save already committed but the mirror
                  // warning must stay READABLE -- the footer swaps to one
                  // explicit Close (removing Save so the committed create
                  // can't be re-fired), and the operator dismisses when
                  // they've read it (BulkBar.tsx's no-auto-close
                  // convention).
                  <Button type="button" onClick={onClose}>
                    {t("workspaceDialogClose")}
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" disabled={saving} onClick={goBack}>
                      {t("equipmentWizardBack")}
                    </Button>
                    <Button
                      type="button"
                      disabled={saving || !selected || (step === "save" && needsAddress && !addressValid)}
                      onClick={() => void handleSaveClick()}
                    >
                      {t("equipmentWizardSavePrinter")}
                    </Button>
                  </>
                )}
              </DialogFooter>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
