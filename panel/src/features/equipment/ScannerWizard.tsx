// P4.3 Task 9 -- the scanner setup wizard (board 5c): a segmented USB-wedge |
// COM toggle, each leading to its own "listen" step with a physical
// verification (a real scan must land before Save is reachable at all),
// plus a RETEST entry point (Task 8's controller-resolved pattern, reused
// here per this task's own controller correction) for a saved scanner row's
// "Test scan" button.
//
// Board 5c drops the "Camera" tab entirely (p4.3-board-5a-5d-extract.md's
// "Deviations decided at brainstorm") -- this file must never render
// anything camera-related; ScannerWizard.test.tsx asserts the string
// "Camera" never appears as a regression guard.
//
// Unlike PrinterWizard.tsx's Find -> Test -> Save (three steps, Save
// reachable even without a confirmed test), this wizard has no analogous
// "skip the confirmation" path: board 5c only ever draws ONE screen state,
// and the device-name/terminator fields don't even exist until a scan has
// actually been detected. So Save/the fields are gated on a confirmed
// detection by construction here, and every save this wizard ever performs
// carries `test_passed: true` -- a detection IS the physical verification,
// there is no separate "did it look right?" judgment call the way a
// printed label needs one.
//
// CONTROLLER CORRECTION (task-9-brief.md): retest mode calls
// useMarkTestPassed on a confirmed detection, same as PrinterWizard's own
// retest flow -- POST /equipment/devices/{id}/test-passed is device-generic
// (works for any class) and test_passed_at is honest data for any device;
// only PRINTER tests feed the readiness gate (the backend rule filters
// class=printer), so stamping it here is safe and consistent, not a
// readiness side-effect in disguise.
import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, cn,
} from "@idento/ui";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { TERMINATOR_LABELS } from "./deviceMeta";
import { useCreateDevice, useMarkTestPassed, type EquipmentDevice } from "./hooks";
import { useWedgeListen, type WedgeDetection } from "./useWedgeListen";
import { agentClient } from "../../shared/agent/agentClient";

export interface ScannerWizardProps {
  open: boolean;
  onClose: () => void;
  // The machine this scanner is being registered under -- same hook-level
  // argument shape as PrinterWizard's `machineId` (see that file's own
  // comment on why useCreateDevice/useMarkTestPassed take it this way).
  machineId: string;
  // Set by a saved scanner row's "Test scan" button -- retest mode. Takes
  // the whole EquipmentDevice (unlike PrinterWizardRetest's bespoke shape)
  // per this task's own interface spec -- there's no extra derived field
  // this wizard needs beyond what the registry row already carries
  // (id/display_name/kind/config.port_name).
  retest?: EquipmentDevice;
}

type Kind = "usb_wedge" | "com";
type ComPhase = "pick-port" | "listening";

const COM_POLL_INTERVAL_MS = 700;

function deviceKind(device: EquipmentDevice): Kind {
  return device.kind === "com" ? "com" : "usb_wedge";
}

export function ScannerWizard({ open, onClose, machineId, retest }: ScannerWizardProps) {
  const { t } = useTranslation();
  const createDevice = useCreateDevice(machineId);
  const markTestPassed = useMarkTestPassed(machineId);

  const isRetest = retest != null;
  const [kind, setKind] = React.useState<Kind>("usb_wedge");
  const effectiveKind = isRetest && retest ? deviceKind(retest) : kind;

  const [comPhase, setComPhase] = React.useState<ComPhase>("pick-port");
  const [selectedPort, setSelectedPort] = React.useState<string | null>(null);
  const [comCode, setComCode] = React.useState<string | null>(null);
  const [comAdding, setComAdding] = React.useState(false);
  const [comAddError, setComAddError] = React.useState<string | null>(null);

  const [displayName, setDisplayName] = React.useState("");
  const [terminator, setTerminator] = React.useState<WedgeDetection["terminator"]>("enter");

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const [testPassedWarning, setTestPassedWarning] = React.useState(false);

  // Session-ref cancel-race guard, same idiom as PrinterWizard.tsx's own
  // sessionRef -- bumped every time the dialog opens/closes so a save/
  // test-passed call that resolves AFTER this session ended never writes
  // into a later session's state.
  const sessionRef = React.useRef(0);
  const firedTestPassedRef = React.useRef<string | null>(null);

  const wedge = useWedgeListen(open && effectiveKind === "usb_wedge");

  // COM listen phase: poll the agent's atomic scan buffer (same
  // POST /scan/consume checkin/useScanInput.ts's "scanner" mode polls)
  // until a non-empty code lands. `enabled` false both stops the poll AND
  // (react-query's own contract) cancels any in-flight request on
  // unmount/disable -- no separate cleanup needed for the "stop on
  // unmount/cancel" requirement.
  const comListening = open && effectiveKind === "com" && comCode === null && (isRetest || comPhase === "listening");
  const consumeQuery = useQuery({
    queryKey: ["equipment", "scanner-wizard", "consume-scan"],
    queryFn: () => agentClient.consumeLastScan(),
    enabled: comListening,
    refetchInterval: COM_POLL_INTERVAL_MS,
    retry: false,
  });
  React.useEffect(() => {
    const code = consumeQuery.data?.code;
    if (code) setComCode(code);
  }, [consumeQuery.data]);

  // Create-mode COM port list -- never fetched in retest mode (the port is
  // already known/open from when the device was first saved).
  const portsQuery = useQuery({
    queryKey: ["equipment", "scanner-wizard", "ports"],
    queryFn: () => agentClient.getScannerPorts(),
    enabled: open && !isRetest && kind === "com" && comPhase === "pick-port",
    retry: false,
  });

  // Resets (or seeds) the whole session whenever the dialog opens/closes or
  // its retest target changes -- same "everything resets on close" shape
  // as PrinterWizard.tsx's own open-keyed effect.
  React.useEffect(() => {
    sessionRef.current += 1;
    firedTestPassedRef.current = null;
    if (!open) return;
    setKind("usb_wedge");
    setComPhase("pick-port");
    setSelectedPort(null);
    setComCode(null);
    setComAdding(false);
    setComAddError(null);
    setDisplayName("");
    setTerminator("enter");
    setSaving(false);
    setSaveError(null);
    setTestPassedWarning(false);
    wedge.reset();
    // Deliberately keyed on `open` + the retest TARGET identity only --
    // must not re-run just because a parent re-renders with a
    // new-but-equal retest object literal, and must not re-run on
    // `wedge.reset` identity churn (stable per useWedgeListen, but not
    // meant to gate this effect either way).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, retest?.id]);

  // Sync the terminator <select> to whatever the LATEST detection reports
  // -- still user-editable afterward (board 5c shows it as a normal
  // select, "Enter · detected" rather than a locked value).
  React.useEffect(() => {
    if (wedge.detection) setTerminator(wedge.detection.terminator);
  }, [wedge.detection]);

  // CONTROLLER CORRECTION (module comment above): retest mode fires
  // useMarkTestPassed the instant a confirmed detection lands, for EITHER
  // kind. No explicit confirm click exists on this wizard (unlike
  // PrinterWizard's "Yes, looks right") -- the detection itself IS the
  // confirmation. Deliberately does not auto-close: there's nothing further
  // to confirm, but the operator should still get to read the "Scan
  // received" row before dismissing (mirrors PrinterWizard's mirror-warning
  // "stays open until the operator dismisses it" convention for the
  // failure case; the success case has nothing left to do either, so it
  // doesn't auto-close as a matter of consistency, not asymmetry).
  React.useEffect(() => {
    if (!open || !isRetest || !retest) return;
    const code = effectiveKind === "usb_wedge" ? wedge.detection?.code : comCode;
    if (!code) return;
    if (firedTestPassedRef.current === retest.id) return;
    firedTestPassedRef.current = retest.id;
    const mySession = sessionRef.current;
    markTestPassed.mutate(
      { params: { path: { device_id: retest.id } } },
      {
        onError: () => {
          if (mySession !== sessionRef.current) return;
          setTestPassedWarning(true);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isRetest, retest, effectiveKind, wedge.detection, comCode]);

  function handleScanAgain() {
    if (effectiveKind === "usb_wedge") {
      wedge.reset();
      return;
    }
    setComCode(null);
  }

  async function handlePickPort(port: string) {
    // Same defense-in-depth re-check as PrinterWizard.tsx's handlers.
    if (comAdding) return;
    const mySession = sessionRef.current;
    setComAdding(true);
    setComAddError(null);
    try {
      await agentClient.addComScanner(port);
      if (mySession !== sessionRef.current) return;
      setSelectedPort(port);
      setComPhase("listening");
    } catch (error) {
      if (mySession !== sessionRef.current) return;
      setComAddError(error instanceof Error ? error.message : t("equipmentWizardComAddError"));
    } finally {
      if (mySession === sessionRef.current) setComAdding(false);
    }
  }

  const detectedCode = effectiveKind === "usb_wedge" ? wedge.detection?.code : comCode;
  const trimmedName = displayName.trim();
  const canSave = !isRetest && Boolean(detectedCode) && trimmedName.length > 0;

  async function handleSave() {
    if (isRetest || saving || !canSave) return;
    const mySession = sessionRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const config: Record<string, unknown> =
        effectiveKind === "usb_wedge" ? { terminator } : { port_name: selectedPort ?? "" };
      await createDevice.mutateAsync({
        params: { path: { machine_id: machineId } },
        body: {
          class: "scanner",
          kind: effectiveKind,
          display_name: trimmedName,
          config,
          // A confirmed detection is a hard prerequisite for `canSave`
          // (see module comment) -- every save this wizard performs has
          // therefore already been physically verified.
          test_passed: true,
        },
      });
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
    if (!next && (saving || comAdding)) return;
    if (!next) onClose();
  }

  function preventDialogDismiss(e: Event) {
    if (saving || comAdding) e.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        // Retest mode's footer always carries its OWN explicit Close (task-
        // 9-brief.md: "Close only") -- hiding the ✕ here avoids two
        // same-named "Close" controls in the same dialog, same reasoning as
        // PrinterWizard.tsx's mirrorWarning branch.
        hideClose={saving || comAdding || isRetest}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader>
          <DialogTitle>{isRetest ? t("equipmentWizardScannerRetestTitle") : t("equipmentWizardScannerTitle")}</DialogTitle>
          {isRetest && retest ? (
            <p className="text-caption text-muted-foreground">{t("equipmentWizardRetestFor", { name: retest.display_name })}</p>
          ) : null}
        </DialogHeader>

        {!isRetest ? (
          <div
            role="group"
            aria-label={t("equipmentWizardScannerTitle")}
            className="inline-flex w-fit gap-0.5 rounded-md border border-border p-0.5"
          >
            <button
              type="button"
              aria-pressed={kind === "usb_wedge"}
              className={cn(
                "rounded-sm px-3 py-1 text-caption font-bold",
                kind === "usb_wedge" ? "bg-success text-success-foreground" : "text-muted-foreground",
              )}
              onClick={() => setKind("usb_wedge")}
            >
              {t("equipmentWizardUsb")}
            </button>
            <button
              type="button"
              aria-pressed={kind === "com"}
              className={cn(
                "rounded-sm px-3 py-1 text-caption font-bold",
                kind === "com" ? "bg-success text-success-foreground" : "text-muted-foreground",
              )}
              onClick={() => setKind("com")}
            >
              {t("equipmentWizardCom")}
            </button>
          </div>
        ) : null}

        {effectiveKind === "usb_wedge" ? (
          <div className="flex flex-col gap-4">
            {!wedge.detection ? (
              <div
                className="flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-success bg-success/5 p-6 text-center"
                data-testid="scanner-wizard-listen-panel"
              >
                <p className="text-card-title font-bold text-foreground">{t("equipmentWizardListening")}</p>
                <p className="text-body text-muted-foreground">{t("equipmentWizardListenHint")}</p>
              </div>
            ) : (
              <div
                className="flex flex-col items-start gap-1 rounded-md border border-success bg-success/5 px-3 py-2"
                data-testid="scanner-wizard-detection"
              >
                <p className="text-body font-bold text-foreground">
                  {t("equipmentWizardScanReceived", { code: wedge.detection.code })}
                </p>
                <p className="font-mono text-caption text-muted-foreground">
                  {TERMINATOR_LABELS[wedge.detection.terminator]} · {wedge.detection.millis} ms
                </p>
                <button
                  type="button"
                  className="text-caption text-success underline underline-offset-2"
                  onClick={handleScanAgain}
                >
                  {t("equipmentWizardScanAgain")}
                </button>
              </div>
            )}

            {wedge.detection ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scanner-wizard-name">{t("equipmentWizardDeviceName")}</Label>
                  <Input
                    id="scanner-wizard-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={saving}
                  />
                </div>
                {!isRetest ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="scanner-wizard-terminator">{t("equipmentWizardTerminator")}</Label>
                    <div className="flex items-center gap-2">
                      <Select
                        id="scanner-wizard-terminator"
                        className="w-auto"
                        value={terminator}
                        onChange={(e) => setTerminator(e.target.value as WedgeDetection["terminator"])}
                        disabled={saving}
                      >
                        <option value="enter">{TERMINATOR_LABELS.enter}</option>
                        <option value="tab">{TERMINATOR_LABELS.tab}</option>
                        <option value="none">{TERMINATOR_LABELS.none}</option>
                      </Select>
                      {terminator === wedge.detection.terminator ? (
                        <span className="text-caption text-muted-foreground">{t("equipmentWizardDetected")}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {isRetest || comPhase === "listening" ? (
              <>
                {comCode === null ? (
                  <div
                    className="flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-success bg-success/5 p-6 text-center"
                    data-testid="scanner-wizard-listen-panel"
                  >
                    <p className="text-card-title font-bold text-foreground">{t("equipmentWizardListening")}</p>
                    <p className="text-body text-muted-foreground">{t("equipmentWizardListenHint")}</p>
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-start gap-1 rounded-md border border-success bg-success/5 px-3 py-2"
                    data-testid="scanner-wizard-detection"
                  >
                    <p className="text-body font-bold text-foreground">{t("equipmentWizardScanReceived", { code: comCode })}</p>
                    <button
                      type="button"
                      className="text-caption text-success underline underline-offset-2"
                      onClick={handleScanAgain}
                    >
                      {t("equipmentWizardScanAgain")}
                    </button>
                  </div>
                )}

                {comCode !== null && !isRetest ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="scanner-wizard-com-name">{t("equipmentWizardDeviceName")}</Label>
                    <Input
                      id="scanner-wizard-com-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-body font-bold text-foreground">{t("equipmentWizardPickPort")}</p>
                {portsQuery.isPending ? (
                  <p className="text-body text-muted-foreground">{t("equipmentWizardAgentChecking")}</p>
                ) : portsQuery.isError ? (
                  <p role="alert" className="text-body text-destructive">
                    {t("equipmentWizardAgentUnreachable")}
                  </p>
                ) : (portsQuery.data ?? []).length === 0 ? (
                  <p className="text-body text-muted-foreground">{t("equipmentWizardNoPorts")}</p>
                ) : (
                  <ul className="flex flex-col gap-2" data-testid="scanner-wizard-ports-list">
                    {(portsQuery.data ?? []).map((port) => (
                      <li key={port}>
                        <button
                          type="button"
                          disabled={comAdding}
                          className="flex w-full items-center justify-between rounded-md border border-success bg-success/5 px-3 py-2 text-left hover:bg-success/10"
                          onClick={() => void handlePickPort(port)}
                        >
                          <span className="font-mono text-body text-foreground">{port}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {comAddError ? (
                  <p role="alert" className="text-body text-destructive">
                    {comAddError}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {testPassedWarning ? (
          <p className="text-body text-warning" role="status">
            {t("equipmentWizardScanTestWarn")}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="text-body text-destructive">
            {saveError}
          </p>
        ) : null}

        <DialogFooter>
          {isRetest ? (
            <Button type="button" onClick={onClose}>
              {t("workspaceDialogClose")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                {t("createEventCancel")}
              </Button>
              <Button type="button" disabled={saving || !canSave} onClick={() => void handleSave()}>
                {t("equipmentWizardSaveScanner")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
