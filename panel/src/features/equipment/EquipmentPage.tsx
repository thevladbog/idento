// P4.3 Task 7 -- the Equipment hub itself (board 5a connected / 5d agent
// down), replacing the `/equipment` PlaceholderPage. Org-level, in-shell
// (no route params, no rail-less top-level registration like
// MonitorPage/StationPage) -- router.tsx just points the existing
// `equipmentRoute` at this component.
//
// Wires together:
// - `useAgentInfo` (Task 5) for the agent identity card + reconcile trigger.
// - `useAgentPrinters(true)` (P3.2) + a small LOCAL `useAgentScanners`
//   (mirroring its health-gated shape -- no shared scanners hook exists yet,
//   task-7-brief.md) for the live device lists.
// - Task 6's `useEquipmentMachine`/mutations + `reconcile.ts` for the
//   registry columns and the reconcile-on-load upsert.
//
// Machine identity: `info?.machine_id ?? cachedInfo?.machine_id ?? null` --
// a live connection wins, but a cached identity from an EARLIER connection
// on this same machine keeps the registry (and board 5d's still-listed
// devices) readable while the agent is down.
import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DropdownMenu,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Label, Skeleton,
} from "@idento/ui";
import { useQuery } from "@tanstack/react-query";
import { Printer, ScanLine } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCard } from "./AgentCard";
import { DeviceCard, type DeviceRow } from "./DeviceCard";
import {
  isEmptyRegistry, useDeleteDevice, useEquipmentMachine, usePatchDevice, useSetDefaultPrinter, useUpsertMachine,
  type EquipmentDevice,
} from "./hooks";
import { PrinterWizard, type PrinterWizardPrefill, type PrinterWizardRetest } from "./PrinterWizard";
import { computeSeenDeviceIds, deviceLiveness, unsavedLivePrinters } from "./reconcile";
import { ScannerWizard } from "./ScannerWizard";
import { agentClient, type AgentPrinter, type AgentScanner } from "../../shared/agent/agentClient";
import { useAgentInfo } from "../../shared/agent/useAgentInfo";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";

const AGENT_SCANNERS_KEY = ["agent", "scanners"] as const;

async function fetchAgentScanners(): Promise<AgentScanner[]> {
  // Health-gated the same way fetchAgentPrinters is (useAgentPrinters.ts) --
  // agentClient.getScanners() itself has no health pre-check of its own.
  const healthy = await agentClient.checkHealth();
  if (!healthy) throw new Error("agent unreachable");
  return agentClient.getScanners();
}

// Local, enabled-gated hook mirroring useAgentPrinters' health-gated shape
// (minus the default-printer bookkeeping that hook also carries) -- kept
// local to this feature per task-7-brief.md ("there is no shared scanners
// hook yet — keep it local to features/equipment").
function useAgentScanners(enabled: boolean) {
  const query = useQuery({
    queryKey: AGENT_SCANNERS_KEY,
    queryFn: fetchAgentScanners,
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const scanners = query.data ?? [];
  let state: "connected" | "disconnected" | "checking";
  if (!enabled) state = "disconnected";
  else if (query.isSuccess) state = "connected";
  else if (query.isError) state = "disconnected";
  else state = "checking";
  return { state, scanners, refetch: query.refetch };
}

type DialogState = { kind: "rename" | "delete"; device: EquipmentDevice } | null;

// P4.3 Task 8 -- which target (if any) the printer wizard is currently open
// for: a fresh create (optionally prefilled from an unsaved live printer's
// "Save…" row) or a RETEST of an already-saved device (a saved row's
// "Test print" button, task-8-brief.md's controller-resolved addition).
type PrinterWizardState = { kind: "create"; prefill?: PrinterWizardPrefill } | { kind: "retest"; device: EquipmentDevice } | null;

// P4.3 Task 9 -- same create/retest shape as PrinterWizardState, minus the
// prefill case (the scanner column has no discovery-based "Save…" row --
// task-7-brief.md's own note that reconcile.ts exposes no
// unsaved-scanner helper).
type ScannerWizardState = { kind: "create" } | { kind: "retest"; device: EquipmentDevice } | null;

interface RenameDialogProps {
  device: EquipmentDevice | null;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
  pending: boolean;
}

// One shared rename dialog instance for BOTH columns (same "single shared
// dialog, driven by which-row-was-clicked state" shape as ZonesPage.tsx's
// ZoneFormDialog/ConfirmDialog), rather than a dialog per row.
function RenameDialog({ device, onOpenChange, onSave, pending }: RenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  // Tracks which device's name is currently loaded into the input, so a
  // background devices refetch (e.g. the reconcile PUT settling) while this
  // dialog is open doesn't stomp on an in-progress edit -- same
  // initializedRef idiom as ZoneFormDialog.tsx.
  const loadedForRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!device) {
      loadedForRef.current = null;
      return;
    }
    if (loadedForRef.current === device.id) return;
    setName(device.display_name);
    loadedForRef.current = device.id;
  }, [device]);

  const trimmed = name.trim();

  return (
    <Dialog open={device !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("workspaceDialogClose")}>
        <DialogHeader>
          <DialogTitle>{t("equipmentRename")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="equipment-rename-input">{t("equipmentRenameLabel")}</Label>
          <Input id="equipment-rename-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("createEventCancel")}
          </Button>
          <Button type="button" disabled={pending || trimmed.length === 0} onClick={() => onSave(trimmed)}>
            {t("settingsSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EquipmentPage() {
  const { t } = useTranslation();

  const agentInfo = useAgentInfo(true);
  const printers = useAgentPrinters(true);
  const scanners = useAgentScanners(true);

  const machineId = agentInfo.info?.machine_id ?? agentInfo.cachedInfo?.machine_id ?? null;
  const machineQuery = useEquipmentMachine(machineId);
  const upsertMachine = useUpsertMachine();
  const patchDevice = usePatchDevice(machineId ?? "");
  const deleteDevice = useDeleteDevice(machineId ?? "");
  const setDefaultPrinter = useSetDefaultPrinter(machineId ?? "");

  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [printerWizard, setPrinterWizard] = React.useState<PrinterWizardState>(null);
  const [scannerWizard, setScannerWizard] = React.useState<ScannerWizardState>(null);
  // P4.3 Task 9 -- best-effort mirror-cleanup warning for a deleted kind=com
  // device (see the delete ConfirmDialog's onConfirm below). Page-level
  // (not inside ConfirmDialog itself, which is a generic @idento/ui
  // primitive out of this feature's touch scope) and, per the "mirror
  // warnings stay visible until explicit dismiss" convention this phase's
  // wizards already follow, cleared ONLY by the operator's own dismiss
  // click -- never auto-cleared by a later render.
  const [comRemoveWarning, setComRemoveWarning] = React.useState<string | null>(null);
  // PR #83 bot-review round 2, Finding 8: best-effort warning for the
  // row-menu "Make default" action's agent mirror (see onSetDefault
  // below) -- same "warn, don't fail; stays visible until the operator's
  // own explicit dismiss" convention as comRemoveWarning above and
  // PrinterWizard.tsx's own mirrorWarning. A plain boolean (not a
  // per-device string like comRemoveWarning) because the copy needs no
  // interpolation -- same shape as PrinterWizard's mirrorWarning.
  const [defaultMirrorWarning, setDefaultMirrorWarning] = React.useState(false);

  // P4.3 Task 8 -- every printer-wizard entry point is guarded on a known
  // machineId: the wizard's create path POSTs to
  // /api/equipment/machines/{machine_id}/devices, and there is nothing
  // honest to save against an unresolved machine identity (the rare
  // "connected_legacy, no cached identity" state still renders the live
  // device grid -- see `showDeviceGrid` below -- but has no registry to
  // register into). A no-op here (rather than a crash) matches the same
  // "honest disabled affordance" spirit as the `wizard-todo` placeholder
  // this replaces.
  function openCreateWizard(prefill?: PrinterWizardPrefill) {
    if (!machineId) return;
    setPrinterWizard({ kind: "create", prefill });
  }
  function openRetestWizard(device: EquipmentDevice) {
    if (!machineId) return;
    setPrinterWizard({ kind: "retest", device });
  }
  // Same machineId guard as the printer wizard's own open* functions above
  // -- there is nothing honest to register/retest against an unresolved
  // machine identity.
  function openCreateScannerWizard() {
    if (!machineId) return;
    setScannerWizard({ kind: "create" });
  }
  function openRetestScannerWizard(device: EquipmentDevice) {
    if (!machineId) return;
    setScannerWizard({ kind: "retest", device });
  }

  // Reconcile-on-load: fires the machine upsert EXACTLY once per
  // machine_id per page visit, once info + the registry + both live lists
  // have all loaded. An empty registry (isEmptyRegistry) still counts as
  // loaded -- upserting IS what registers a never-seen machine.
  const upsertedMachineRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!machineId || agentInfo.state !== "connected" || !agentInfo.info) return;
    const registrySettled = machineQuery.isSuccess || isEmptyRegistry(machineQuery.error);
    if (!registrySettled) return;
    // Task 7 review finding 1: both live lists must have SUCCEEDED, not
    // merely settled -- an errored /printers or /scanners fetch surfaces as
    // state "disconnected" with an EMPTY list, and reconciling off that
    // would under-report seen_device_ids (a genuinely-live device gets no
    // last_seen_at advance and later reads as a false "not seen since").
    // The backend PUT is additive-only (never marks devices unseen), so
    // skipping is strictly safe; and because this early-return happens
    // BEFORE the ref below is written, a skipped attempt never consumes the
    // once-per-machine_id budget -- a later successful refetch (window
    // refocus, a not-seen row's Retry, the 8s auto-retry) still reconciles
    // exactly once.
    if (printers.state !== "connected" || scanners.state !== "connected") return;
    if (upsertedMachineRef.current === machineId) return;
    upsertedMachineRef.current = machineId;
    const seenDeviceIds = computeSeenDeviceIds(machineQuery.data?.devices ?? [], printers.printers, scanners.scanners);
    upsertMachine.mutate({
      params: { path: { machine_id: machineId } },
      body: { hostname: agentInfo.info.hostname, agent_version: agentInfo.info.version, seen_device_ids: seenDeviceIds },
    });
    // printers.printers/scanners.scanners/machineQuery.data/upsertMachine
    // are read fresh, once, inside the ref-guarded body above -- their own
    // reference churn must not retrigger this effect; only the SETTLEMENT
    // flags themselves (state/isSuccess/error) gate re-evaluation, same
    // "guard, then read fresh at fire time" shape as ImportWizard.tsx's
    // step-3 auto-start effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, agentInfo.state, agentInfo.info, machineQuery.isSuccess, machineQuery.error, printers.state, scanners.state]);

  const devices = machineQuery.data?.devices ?? [];
  const printerRows: DeviceRow[] = devices
    .filter((device) => device.class === "printer")
    .map((device) => ({ device, liveness: deviceLiveness(device, printers.printers, scanners.scanners) }));
  const scannerRows: DeviceRow[] = devices
    .filter((device) => device.class === "scanner")
    .map((device) => ({ device, liveness: deviceLiveness(device, printers.printers, scanners.scanners) }));
  const unsavedPrinters = unsavedLivePrinters(devices, printers.printers);

  const agentDown = agentInfo.state === "disconnected";
  // PR #83 bot-review round 2, Finding 8: whether the agent can actually
  // accept an HTTP mirror call right now -- "connected" and
  // "connected_legacy" both mean a healthy, reachable agent (see
  // useAgentInfo.ts's own AgentInfoState doc comment); "checking" and
  // "disconnected" do not. Deliberately its OWN check rather than
  // `!agentDown` -- "checking" is neither, and attempting a mirror call
  // mid-probe would be the same premature-attempt hazard `agentDown`
  // itself doesn't distinguish.
  const agentReachable = agentInfo.state === "connected" || agentInfo.state === "connected_legacy";
  // Board 5d cold start: no cached/live machine identity AND the agent
  // itself unreachable -- nothing honest to show (no registry to key by,
  // no live agent to discover printers/scanners from either). Every other
  // combination (a live-but-legacy agent with no registry identity yet, or
  // a known machine_id with the agent down) still has SOMETHING real to
  // render.
  const showDeviceGrid = machineId !== null || !agentDown;

  // Task 7 review finding 3 (TanStack v5): `isLoading` is
  // `isPending && isFetching`, so it is FALSE for a disabled query -- the
  // same v5 semantics useAgentInfo.ts already documents for stale data.
  // Two genuinely-pending windows must show the skeleton instead of
  // DeviceCard's real empty-state markup: the machine query actively
  // fetching (enabled, `isPending` until first success/error), and the
  // pre-identity window (agent probe still "checking" with no cached
  // machine_id -- the query is disabled, so no query flag covers it).
  // A legacy agent with no cache (machineId stays null, state
  // "connected_legacy") deliberately falls through to the live-only view.
  const registryPending =
    (machineId !== null && machineQuery.isPending) || (machineId === null && agentInfo.state === "checking");
  // Task 7 review finding 2: a genuine (non-404) registry failure must
  // never render as "No printers/scanners saved yet" -- that's the exact
  // "silent empty list" board 5d's caption calls out. The true 404
  // (never-registered machine) stays the empty state it really is.
  const registryError = machineQuery.isError && !isEmptyRegistry(machineQuery.error);

  function closeDialog() {
    setDialog(null);
  }

  // PR #83 bot-review round 2, Finding 8: the wizard's own Save path
  // already mirrors make_default onto the agent's /printers/default
  // (PrinterWizard.tsx's handleSaveClick) so a legacy web reader of the
  // AGENT's own default stays in sync -- the row-menu's "Make default"
  // action only wrote the registry, leaving that mirror stale until some
  // OTHER action happened to repoint it. Same "warn, don't fail" posture:
  // the registry write (source of truth, spec §5.3 "server-wins") has
  // ALREADY succeeded by the time this runs, so a mirror failure must
  // never be presented as the set-default failing.
  function mirrorDefaultToAgent(device: EquipmentDevice) {
    if (!agentReachable) return;
    const agentName = device.config?.agent_name as string | undefined;
    if (!agentName) return;
    agentClient.setDefaultPrinter(agentName).catch(() => {
      setDefaultMirrorWarning(true);
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-page-title">{t("equipmentTitle")}</h1>
        <span className="text-caption text-muted-foreground">{t("equipmentCaption")}</span>
        <div className="ml-auto">
          {/* Task 8 wired the Printer option to the real wizard; Task 9
              wires Scanner the same way -- the last `wizard-todo`
              placeholder on this page is gone. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* PR #83 bot-review round 1, Finding 3: disabled whenever
                  machineId is null -- both menu items' handlers
                  (openCreateWizard/openCreateScannerWizard) already no-op
                  in that state; the trigger itself must be honest about it
                  too. */}
              <Button type="button" disabled={machineId === null}>
                {t("equipmentAddDevice")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openCreateWizard()}>{t("equipmentAddPrinter")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openCreateScannerWizard()}>{t("equipmentAddScanner")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AgentCard agent={agentInfo} />

      {showDeviceGrid ? (
        registryPending ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="equipment-registry-skeleton">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : registryError ? (
          // Same "error text + Retry" shape as ZonesPage.tsx's list-error
          // state -- an explicit failure card, never a fabricated empty
          // list (review finding 2).
          <div
            className="flex flex-col items-start gap-2 rounded-lg border border-border p-6"
            data-testid="equipment-registry-error"
          >
            <p className="text-body text-destructive">{t("equipmentRegistryLoadError")}</p>
            <Button type="button" variant="outline" onClick={() => void machineQuery.refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DeviceCard
              testId="equipment-printers-card"
              icon={Printer}
              titleText={t("equipmentPrinters")}
              emptyTitle={t("equipmentEmptyPrinters")}
              footerText={t("equipmentDefaultFooter")}
              setUpLabel={t("equipmentSetUpPrinter")}
              rows={printerRows}
              unsavedPrinters={unsavedPrinters}
              agentDown={agentDown}
              showDefaultControls
              // PR #83 bot-review round 1, Finding 3: see DeviceCardProps'
              // own comment -- Set up/Save… render disabled whenever
              // machineId is null (legacy agent, no cached identity).
              disableActions={machineId === null}
              onRename={(device) => setDialog({ kind: "rename", device })}
              onSetDefault={(device) =>
                setDefaultPrinter.mutate(
                  {
                    params: { path: { machine_id: machineId ?? "" } },
                    body: { device_id: device.id },
                  },
                  // Finding 8: mirror onto the agent AFTER the registry
                  // write (the source of truth) has actually succeeded.
                  { onSuccess: () => mirrorDefaultToAgent(device) },
                )
              }
              onClearDefault={() =>
                setDefaultPrinter.mutate({
                  params: { path: { machine_id: machineId ?? "" } },
                  body: { device_id: null },
                })
              }
              onDelete={(device) => setDialog({ kind: "delete", device })}
              onRetryLive={() => void printers.refetch()}
              onSetUp={() => openCreateWizard()}
              onSaveUnsaved={(printer: AgentPrinter) => openCreateWizard({ agentName: printer.name, type: printer.type })}
              onTestPrint={(device) => openRetestWizard(device)}
            />
            <DeviceCard
              testId="equipment-scanners-card"
              icon={ScanLine}
              titleText={t("equipmentScanners")}
              emptyTitle={t("equipmentEmptyScanners")}
              footerText={t("equipmentPersistFooter")}
              setUpLabel={t("equipmentSetUpScanner")}
              rows={scannerRows}
              agentDown={agentDown}
              showDefaultControls={false}
              disableActions={machineId === null}
              onRename={(device) => setDialog({ kind: "rename", device })}
              onSetDefault={() => {}}
              onClearDefault={() => {}}
              onDelete={(device) => setDialog({ kind: "delete", device })}
              onRetryLive={() => void scanners.refetch()}
              onSetUp={() => openCreateScannerWizard()}
              onTestScan={(device) => openRetestScannerWizard(device)}
            />
          </div>
        )
      ) : null}

      <RenameDialog
        device={dialog?.kind === "rename" ? dialog.device : null}
        pending={patchDevice.isPending}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        onSave={(name) => {
          if (dialog?.kind !== "rename") return;
          patchDevice.mutate(
            { params: { path: { device_id: dialog.device.id } }, body: { display_name: name } },
            { onSuccess: closeDialog },
          );
        }}
      />

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={t("equipmentDelete")}
        description={dialog?.kind === "delete" ? t("equipmentDeleteConfirm", { name: dialog.device.display_name }) : ""}
        confirmLabel={t("equipmentDelete")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={deleteDevice.isPending}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          const device = dialog.device;
          deleteDevice.mutate(
            { params: { path: { device_id: device.id } } },
            {
              onSuccess: () => {
                closeDialog();
                // Task 9 -- best-effort mirror cleanup for a deleted
                // kind=com device: the registry delete above is the
                // source of truth and has ALREADY succeeded by the time
                // this runs, so a failure here must never resurrect the
                // device or block the delete -- same "warn, don't fail"
                // posture as PrinterWizard's default-mirror call. The
                // stable link is config.port_name (reconcile.ts's own
                // matching rule); agent/openapi.yaml's ScannerRequest
                // confirms both /scanners/add and /scanners/remove key
                // off exactly that field, so no live getScanners() lookup
                // is needed to resolve a different identifier.
                if (device.class === "scanner" && device.kind === "com") {
                  const portName = device.config?.port_name as string | undefined;
                  if (portName) {
                    agentClient.removeComScanner(portName).catch(() => {
                      setComRemoveWarning(t("equipmentComRemoveWarn", { name: device.display_name }));
                    });
                  }
                }
              },
            },
          );
        }}
      />

      {comRemoveWarning ? (
        <div
          role="status"
          data-testid="equipment-com-remove-warning"
          className="flex items-center justify-between gap-3 rounded-lg border border-warning bg-warning/5 px-4 py-2"
        >
          <p className="text-body text-warning">{comRemoveWarning}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setComRemoveWarning(null)}>
            {t("workspaceDialogClose")}
          </Button>
        </div>
      ) : null}

      {defaultMirrorWarning ? (
        <div
          role="status"
          data-testid="equipment-default-mirror-warning"
          className="flex items-center justify-between gap-3 rounded-lg border border-warning bg-warning/5 px-4 py-2"
        >
          <p className="text-body text-warning">{t("equipmentDefaultMirrorWarn")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setDefaultMirrorWarning(false)}>
            {t("workspaceDialogClose")}
          </Button>
        </div>
      ) : null}

      <PrinterWizard
        open={printerWizard !== null}
        onClose={() => setPrinterWizard(null)}
        machineId={machineId ?? ""}
        prefill={printerWizard?.kind === "create" ? printerWizard.prefill : undefined}
        retest={printerWizard?.kind === "retest" ? deviceToRetest(printerWizard.device) : undefined}
        // Task 8 review fix round Minor 5: already-registered printers
        // (matched by config.agent_name, the stable agent-side link) are
        // excluded from the wizard's Find list -- same filter the hub's
        // own unsaved-rows section applies via unsavedLivePrinters.
        registeredAgentNames={devices
          .filter((device) => device.class === "printer")
          .map((device) => device.config?.agent_name as string | undefined)
          .filter((agentName): agentName is string => agentName != null)}
      />

      <ScannerWizard
        open={scannerWizard !== null}
        onClose={() => setScannerWizard(null)}
        machineId={machineId ?? ""}
        retest={scannerWizard?.kind === "retest" ? scannerWizard.device : undefined}
      />
    </div>
  );
}

// Board 5a's saved printer row carries the agent-side link in
// `config.agent_name` (config is a loose object, schema.d.ts -- validated
// server-side, not typed here; same defensive read as reconcile.ts's
// deviceLiveness). A device with no agent_name (shouldn't happen for a
// class=printer row, but config is technically free-form) falls back to
// display_name rather than crashing the wizard open. `kind` narrows the
// registry's four-kind union to the wizard's printer pair -- a printer row
// is only ever system|network, but the schema type can't say so.
function deviceToRetest(device: EquipmentDevice): PrinterWizardRetest {
  const agentName = (device.config?.agent_name as string | undefined) ?? device.display_name;
  return {
    deviceId: device.id,
    agentName,
    displayName: device.display_name,
    kind: device.kind === "network" ? "network" : "system",
  };
}
