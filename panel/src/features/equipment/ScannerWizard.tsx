// P4.3 Task 9 -- the scanner setup wizard (board 5c): a segmented USB-wedge |
// COM toggle, each leading to its own "listen" step with a physical
// verification, plus a RETEST entry point (Task 8's controller-resolved
// pattern, reused here per this task's own controller correction) for a
// saved scanner row's "Test scan" button.
//
// Board 5c drops the "Camera" tab entirely (p4.3-board-5a-5d-extract.md's
// "Deviations decided at brainstorm") -- this file must never render
// anything camera-related; ScannerWizard.test.tsx asserts the string
// "Camera" never appears as a regression guard.
//
// Save gating (task-9 review fix round, Important-1 -- the reviewer's
// adjudication of the original report's concern 1): PrinterWizard's
// brief-mandated "save without a confirmed test sends test_passed: false"
// precedent governs here too. The name/terminator fields are editable from
// the start (register-now-verify-later: hardware ordered ahead of an
// event, a flaky trigger, ...), Save requires only a non-empty name (plus
// a chosen port for the COM path -- config.port_name is a hard server-side
// requirement for kind=com), and `test_passed` on the create is simply
// whether a detection actually landed this session: a confirmed scan
// upgrades the save's claim to true, its absence is honestly reported as
// false, never blocked.
//
// CONTROLLER CORRECTION (task-9-brief.md): retest mode calls
// useMarkTestPassed on a confirmed detection, same as PrinterWizard's own
// retest flow -- POST /equipment/devices/{id}/test-passed is device-generic
// (works for any class) and test_passed_at is honest data for any device;
// only PRINTER tests feed the readiness gate (the backend rule filters
// class=printer), so stamping it here is safe and consistent, not a
// readiness side-effect in disguise.
import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent,
  SelectItem, SelectTrigger, SelectValue, cn,
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
  // POST /scan/consume checkin/useScanInput.ts's "scanner" mode polls) until
  // a non-empty code lands. Implemented as an imperative effect (mirroring
  // useScanInput's own interval+in-flight-guard poll idiom) rather than a
  // useQuery refetchInterval, because this poll needs two guarantees a
  // query can't cleanly give:
  //
  // 1. DISCARD-FIRST (task-9 review fix round, CRITICAL): the agent's scan
  //    buffer is one process-wide buffer (agent/scan_buffer.go) -- shared
  //    by every /scan/consume caller and NOT scoped per port, per device,
  //    or per session. A COM port stays open from the moment it's added
  //    (and auto-reopens at agent startup, per agent/openapi.yaml's
  //    /scanners/add description), so a scan from BEFORE this wizard
  //    opened -- or from a DIFFERENT com scanner entirely -- can be
  //    sitting in the buffer when listening starts. Trusting the first
  //    non-empty consume would let that stale data pass as this session's
  //    physical verification (and, in retest mode, silently stamp
  //    test_passed_at with zero operator action). So the first consume of
  //    every listen session is a pure discard: its result is dropped
  //    unread. Because /scan/consume atomically reads-and-clears under one
  //    server-side lock, everything a LATER poll returns is guaranteed to
  //    have arrived after the discard -- i.e. after listening genuinely
  //    began.
  // 2. ABORT-ON-CANCEL (review Important-2): consuming DRAINS the shared
  //    buffer as a side effect, so an in-flight request left running after
  //    the operator cancels/closes could still eat a real scan the
  //    check-in station's own poll needed. The cleanup below aborts the
  //    in-flight fetch via AbortController, not just the future ticks.
  //    Honest scope (review round 2, Minor): the abort stops the CLIENT's
  //    wait and all further polls -- it cannot un-consume a request the
  //    agent already processed at abort time (inherent to HTTP; that one
  //    residual request is the same exposure any in-flight poll has).
  const comListening = open && effectiveKind === "com" && comCode === null && (isRetest || comPhase === "listening");
  React.useEffect(() => {
    if (!comListening) return;
    const controller = new AbortController();
    let cancelled = false;
    let pollInFlight = false;
    let discarded = false;

    async function tick() {
      // In-flight guard, same shape as useScanInput.ts's own poll: a tick
      // landing while the previous round trip is still outstanding no-ops
      // instead of stacking requests against a slow/stalled agent.
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const scan = await agentClient.consumeLastScan(controller.signal);
        if (cancelled) return;
        if (!discarded) {
          // The discard consume -- result intentionally dropped (see
          // point 1 above). Only a SUCCESSFUL consume counts as the
          // discard; an errored attempt leaves `discarded` false so the
          // next tick retries the discard before anything is trusted.
          discarded = true;
          return;
        }
        if (scan.code) setComCode(scan.code);
      } catch {
        // Agent unreachable (or our own abort) -- keep the interval
        // running; the next tick retries. `cancelled` above prevents any
        // state write after cleanup.
      } finally {
        pollInFlight = false;
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), COM_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [comListening]);

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
  //
  // PR #83 bot-review round 2, Finding 2: `wedge.reset()`/`setComCode(null)`
  // used to live BELOW the `if (!open) return;` guard, so closing with a
  // live detection left it sitting in state. Reopening straight into
  // retest mode reset `firedTestPassedRef` to null synchronously (a ref
  // mutation) in the SAME effect run whose `wedge.reset()` call (a
  // deferred setState) hadn't committed yet -- the retest auto-fire effect
  // runs in that SAME commit and used to see the STALE detection/comCode
  // alongside the freshly-cleared ref, POSTing test-passed for the NEW
  // retest device off a scan from a PREVIOUS, unrelated session. Clearing
  // both BEFORE the early return means a close's reset always commits (in
  // an earlier render) before any later reopen's effect run can observe a
  // stale value -- impossible by construction, not by timing.
  React.useEffect(() => {
    sessionRef.current += 1;
    firedTestPassedRef.current = null;
    wedge.reset();
    setComCode(null);
    if (!open) return;
    setKind("usb_wedge");
    setComPhase("pick-port");
    setSelectedPort(null);
    setComAdding(false);
    setComAddError(null);
    setDisplayName("");
    setTerminator("enter");
    setSaving(false);
    setSaveError(null);
    setTestPassedWarning(false);
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
  // Review fix round Important-1: a detection is NOT required to save --
  // only a name (and, for COM, a chosen port: config.port_name is a hard
  // server-side requirement for kind=com, so there is nothing valid to
  // save before the port pick). See the module comment's gating paragraph.
  const canSave =
    !isRetest && trimmedName.length > 0 && (effectiveKind === "usb_wedge" || selectedPort !== null);

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
          // Honest per-session claim (review Important-1, PrinterWizard's
          // test_passed parity): true only when a detection actually
          // landed during THIS session; an unverified register-now save
          // reports false rather than being blocked.
          test_passed: Boolean(detectedCode),
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

  // PR #83 bot-review round 1, Finding 5: `markTestPassed.isPending` must
  // gate every dismiss path too, not just saving/comAdding -- retest's
  // auto-fired POST /test-passed used to sit outside every busy check, so
  // Close stayed clickable mid-flight. Closing bumps sessionRef (the
  // open-keyed reset effect above), so a LATE failure's onError saw a
  // stale session and silently dropped the testPassedWarning -- the
  // operator never learned the stamp didn't take.
  //
  // PR #83 bot-review round 2, Finding 6 (CodeRabbit Major): this exact
  // three-flag expression was duplicated verbatim in handleOpenChange and
  // preventDialogDismiss -- the house dialog convention wants ONE
  // comprehensive isBusy per dialog. Extracted here and reused below.
  const isBusy = saving || comAdding || markTestPassed.isPending;

  function handleOpenChange(next: boolean) {
    if (!next && isBusy) return;
    if (!next) onClose();
  }

  function preventDialogDismiss(e: Event) {
    if (isBusy) e.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        // Retest mode's footer always carries its OWN explicit Close (task-
        // 9-brief.md: "Close only") -- hiding the ✕ here avoids two
        // same-named "Close" controls in the same dialog, same reasoning as
        // PrinterWizard.tsx's mirrorWarning branch. `isBusy` already
        // includes markTestPassed.isPending (retest's only busy signal --
        // saving/comAdding are always false in retest mode), so this now
        // covers every in-flight op, not just two of the three.
        hideClose={isBusy || isRetest}
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

            {!isRetest ? (
              // Review fix round Important-1: the fields are editable from
              // the start -- a detection syncs the terminator select but is
              // not a prerequisite (register-now-verify-later,
              // PrinterWizard's precedent). Retest mode has no fields at
              // all: it neither renames nor re-saves anything.
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
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scanner-wizard-terminator">{t("equipmentWizardTerminator")}</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={terminator}
                      onValueChange={(next) => setTerminator(next as WedgeDetection["terminator"])}
                      disabled={saving}
                    >
                      <SelectTrigger id="scanner-wizard-terminator" className="w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enter">{TERMINATOR_LABELS.enter}</SelectItem>
                        <SelectItem value="tab">{TERMINATOR_LABELS.tab}</SelectItem>
                        <SelectItem value="none">{TERMINATOR_LABELS.none}</SelectItem>
                      </SelectContent>
                    </Select>
                    {wedge.detection && terminator === wedge.detection.terminator ? (
                      <span className="text-caption text-muted-foreground">{t("equipmentWizardDetected")}</span>
                    ) : null}
                  </div>
                </div>
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

                {!isRetest ? (
                  // Review fix round Important-1: editable through the
                  // whole listening phase, not gated on a detection --
                  // once the port is chosen the device is saveable
                  // (test_passed honestly false until a scan lands).
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
                        {/* PR #83 bot-review round 2, Finding 5: was a
                            hand-rolled styled <button> -- panel/AGENTS.md
                            mandates @idento/ui primitives. Same
                            "ghost variant + className override for row-item
                            styling" composition as PrinterWizard.tsx's own
                            Find-list fix and DeviceCard.tsx's round-1
                            dropdown-trigger fix (Finding 10). */}
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={comAdding}
                          className="h-auto w-full items-center justify-between rounded-md border border-success bg-success/5 px-3 py-2 text-left font-normal hover:bg-success/10"
                          onClick={() => void handlePickPort(port)}
                        >
                          <span className="font-mono text-body text-foreground">{port}</span>
                        </Button>
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
            // Finding 5: disabled while markTestPassed is in flight -- see
            // the handleOpenChange/preventDialogDismiss comment above. Now
            // expressed via the shared `isBusy` (round 2, Finding 6) --
            // saving/comAdding are always false in retest mode, so this is
            // unchanged behaviorally.
            <Button type="button" disabled={isBusy} onClick={onClose}>
              {t("workspaceDialogClose")}
            </Button>
          ) : (
            <>
              {/* PR #83 bot-review round 1, Finding 7: gated on comAdding
                  too, not just saving -- handleOpenChange/
                  preventDialogDismiss (✕/Escape/outside-click) already do,
                  but this explicit button didn't, so a click mid
                  /scanners/add closed the dialog with no registry row and
                  no warning about the agent-side port possibly already
                  being open. Now expressed via `isBusy` (round 2,
                  Finding 6) -- markTestPassed.isPending is always false in
                  create mode, so this is unchanged behaviorally. */}
              <Button type="button" variant="outline" disabled={isBusy} onClick={onClose}>
                {t("createEventCancel")}
              </Button>
              <Button type="button" disabled={isBusy || !canSave} onClick={() => void handleSave()}>
                {t("equipmentWizardSaveScanner")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
