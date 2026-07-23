// P4.3 Task 7 -- board 5a/5d's device column card, parameterized over class
// (printer/scanner) so EquipmentPage mounts exactly one component twice
// rather than two near-duplicate files. Presentation-only: every mutation
// (rename/set-default/clear-default/delete) is a callback prop -- the
// actual dialogs (RenameDialog / ConfirmDialog) are owned ONCE by
// EquipmentPage, same "one shared dialog instance, not one per row" shape
// as ZonesPage.tsx's ZoneFormDialog/ConfirmDialog.
//
// Liveness dots reuse `@idento/ui`'s StatusPill `variant="bare"` (the
// P4.2 StationsCard idiom -- panel/AGENTS.md: UI primitives only, never a
// hand-rolled dot): "live" -> status="ready" (green), "not_seen" ->
// status="in_progress" (amber, matching StationsCard's own stale-row
// color), agent-down overrides either to status="empty" (gray). A
// class="scanner" kind="usb_wedge" row has liveness "none" -- no dot is
// rendered at all (reconcile.ts's own honesty rule: the agent has no
// visibility into a wedge scanner's presence, so showing ANY dot color
// would be a fabrication) -- callers can assert this via the ABSENCE of
// the `equipment-device-dot-*` testid.
//
// Global Constraints (task-7-brief.md): "never color alone" here is
// satisfied by StatusPill's own sr-only label (dot) PLUS, for the
// non-live states, a separately visible caption ("Saved · not seen
// since…"/"saved · unreachable") -- never a bare colored dot alone.
import {
  Button, Card, CardContent, CardFooter, CardHeader, CardTitle, cn, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, EmptyState, StatusPill,
} from "@idento/ui";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deviceMetaLine } from "./deviceMeta";
import type { EquipmentDevice } from "./hooks";
import type { Liveness } from "./reconcile";
import type { AgentPrinter } from "../../shared/agent/agentClient";

export interface DeviceRow {
  device: EquipmentDevice;
  liveness: Liveness;
}

export interface DeviceCardProps {
  testId: string;
  icon: LucideIcon;
  titleText: string;
  emptyTitle: string;
  footerText: string;
  setUpLabel: string;
  rows: DeviceRow[];
  // Live agent printers with no matching registry row (reconcile.ts's
  // unsavedLivePrinters) -- printer column only; the scanner column has no
  // equivalent (reconcile.ts exposes no unsaved-scanner helper -- GET
  // /scanners only ever reports COM ports the WIZARD already opened, so a
  // bare "unsaved live scanner" isn't a state this task's data layer can
  // produce yet).
  unsavedPrinters?: AgentPrinter[];
  agentDown: boolean;
  // Only the printer column exposes Make/Clear default (spec §5.2's
  // default rule is printer-specific; scanners have no such concept).
  showDefaultControls: boolean;
  onRename: (device: EquipmentDevice) => void;
  onSetDefault: (device: EquipmentDevice) => void;
  onClearDefault: (device: EquipmentDevice) => void;
  onDelete: (device: EquipmentDevice) => void;
  // "Edit address…" row-menu action, shown only for a network printer row
  // (device.kind === "network" -- the only class/kind pair with an ip/port
  // to edit; the 2026-07-20 Zebra run's gap: previously the only way to
  // change a saved network printer's address was delete + recreate).
  // Printer-column only (mirrors showDefaultControls' own "only the printer
  // column has this concept" shape) -- undefined for the scanner column,
  // same "no affordance, not a disabled one" convention as onTestPrint.
  onEditAddress?: (device: EquipmentDevice) => void;
  // P4.3 Task 6 (printer pairing QR export) -- row-menu "Download pairing
  // QR" action, same "network printer row only" gate as onEditAddress above
  // (only a network printer's registry row carries the ip/port that
  // PrinterQRData needs). Printer-column only -- undefined for the scanner
  // column, same "no affordance, not a disabled one" convention.
  onDownloadPairingQr?: (device: EquipmentDevice) => void;
  onRetryLive: () => void;
  // P4.3 Task 8 -- when provided, the header + empty-state "+ Set up …"
  // buttons become the REAL enabled affordance (opens the class's wizard)
  // instead of the honest-disabled `wizard-todo` placeholder. Left
  // undefined for a class with no wizard wired yet (scanners, until
  // Task 9) so that column keeps the disabled placeholder untouched.
  onSetUp?: () => void;
  // P4.3 Task 8 -- an unsaved live printer's own "Save…" affordance
  // becomes real once provided (printer column only -- `unsavedPrinters`
  // is never populated for scanners, so this is naturally never rendered
  // there either way).
  onSaveUnsaved?: (printer: AgentPrinter) => void;
  // P4.3 Task 8's controller-resolved plan addition -- board 5a's
  // board-drawn "Test print" button on a saved, LIVE printer row, wired
  // to the wizard's retest entry point (opens straight at Test, no
  // Find/Save). Printer column only; undefined elsewhere renders nothing
  // (not a disabled placeholder -- unlike Set up/Save, this action has no
  // "coming in a later task" story, it simply doesn't apply).
  onTestPrint?: (device: EquipmentDevice) => void;
  // P4.3 Task 9's counterpart for the scanner column -- ScannerWizard's own
  // retest entry point (task-9-brief.md). Shown on EVERY usb_wedge row
  // (liveness is always "none" for those -- reconcile.ts's honesty rule
  // means there is no live/not_seen distinction to gate on, and a wedge
  // test is purely a browser-side capture that doesn't need the agent to
  // report the device at all) as well as any "live" com scanner row (same
  // liveness gate onTestPrint already uses for printers).
  onTestScan?: (device: EquipmentDevice) => void;
  // PR #83 bot-review round 1, Finding 3: a legacy agent (connected_legacy)
  // with NO cached machine identity has machineId === null in
  // EquipmentPage.tsx -- onSetUp/onSaveUnsaved are still PROVIDED (this
  // column has a real wizard wired), but their handlers are guarded to
  // silently no-op with no machineId to register against. Rendering those
  // buttons fully enabled made them look actionable while doing nothing.
  // When true, the Set up (header + empty-state) and Save… buttons render
  // disabled instead -- the WHY is already visible via AgentCard's
  // `equipmentAgentLegacyHint` above this card, so no extra copy is needed
  // here. Left `false`/undefined for every OTHER state (including "no
  // wizard wired yet", which already renders the separate `wizard-todo`
  // placeholder untouched by this prop).
  disableActions?: boolean;
}

function formatNotSeenDate(iso: string, locale: string): string {
  // Pinned to UTC, not the viewer's local timezone -- same house
  // convention as TotalsCard.tsx's formatTime/EventRow.tsx's formatDate
  // for every OTHER server-recorded timestamp on this codebase: a
  // check-in-domain moment (here, the agent's last-seen report) must
  // never shift with the viewer's clock.
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
}

export function DeviceCard({
  testId, icon: Icon, titleText, emptyTitle, footerText, setUpLabel, rows, unsavedPrinters = [], agentDown,
  showDefaultControls, onRename, onSetDefault, onClearDefault, onDelete, onEditAddress, onDownloadPairingQr,
  onRetryLive, onSetUp, onSaveUnsaved, onTestPrint, onTestScan, disableActions = false,
}: DeviceCardProps) {
  const { t, i18n } = useTranslation();
  const isEmpty = rows.length === 0 && unsavedPrinters.length === 0;

  return (
    <Card data-testid={testId} className={cn(agentDown && "opacity-55")}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-baseline gap-2">
          <CardTitle>{titleText}</CardTitle>
          <span className="font-mono text-caption text-muted-foreground">{rows.length}</span>
          {agentDown ? (
            <span className="text-caption text-muted-foreground" data-testid={`${testId}-unreachable`}>
              {t("equipmentUnreachable")}
            </span>
          ) : null}
        </div>
        {onSetUp ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-success"
            disabled={disableActions}
            onClick={onSetUp}
          >
            {setUpLabel}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled data-testid="wizard-todo" className="text-success">
            {setUpLabel}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-0 p-0">
        {isEmpty ? (
          <div className="p-6">
            <EmptyState
              icon={Icon}
              title={emptyTitle}
              actions={
                onSetUp ? (
                  <Button type="button" variant="outline" disabled={disableActions} onClick={onSetUp}>
                    {setUpLabel}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled data-testid="wizard-todo">
                    {setUpLabel}
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            {rows.map(({ device, liveness }) => {
              const metaLine = deviceMetaLine(device);
              const notSeenText = device.last_seen_at
                ? t("equipmentNotSeenSince", { date: formatNotSeenDate(device.last_seen_at, i18n.language) })
                : t("equipmentNotSeenYet");
              const dotStatus = agentDown ? "empty" : liveness === "live" ? "ready" : "in_progress";
              const dotLabel = agentDown ? t("equipmentUnreachable") : liveness === "live" ? metaLine : notSeenText;

              return (
                <div
                  key={device.id}
                  data-testid={`equipment-device-row-${device.id}`}
                  className={cn(
                    "flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0",
                    !agentDown && liveness === "live" && "border-l-[3px] border-l-success bg-success/5",
                  )}
                >
                  {liveness !== "none" ? (
                    <span data-testid={`equipment-device-dot-${device.id}`}>
                      <StatusPill status={dotStatus} label={dotLabel} variant="bare" />
                    </span>
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-body font-bold text-foreground">{device.display_name}</span>
                      {device.is_default ? (
                        <span
                          data-testid={`equipment-default-chip-${device.id}`}
                          className="rounded border border-success px-1 text-[10px] font-bold uppercase tracking-wide text-success"
                        >
                          {t("equipmentDefaultChip")}
                        </span>
                      ) : null}
                    </span>
                    {liveness === "not_seen" ? (
                      <span
                        className={cn("text-caption", agentDown ? "text-muted-foreground" : "text-warning")}
                        data-testid={`equipment-device-notseen-${device.id}`}
                      >
                        {notSeenText}
                      </span>
                    ) : (
                      // "live" AND "none" (wedge scanners -- no observable
                      // liveness at all, per reconcile.ts's honesty rule)
                      // both show the plain mono meta line -- a wedge row
                      // never fabricates a "not seen" claim it can't back up.
                      <span
                        className="font-mono text-caption text-muted-foreground"
                        data-testid={`equipment-device-meta-${device.id}`}
                      >
                        {metaLine}
                      </span>
                    )}
                  </div>
                  {!agentDown ? (
                    <>
                      {liveness === "not_seen" ? (
                        <Button type="button" variant="outline" size="sm" onClick={onRetryLive}>
                          {t("retry")}
                        </Button>
                      ) : null}
                      {liveness === "live" && onTestPrint ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onTestPrint(device)}>
                          {t("equipmentTestPrint")}
                        </Button>
                      ) : null}
                      {onTestScan && (liveness === "live" || device.kind === "usb_wedge") ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onTestScan(device)}>
                          {t("equipmentTestScan")}
                        </Button>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          {/* PR #83 bot-review round 1, Finding 10: was a
                              hand-rolled styled <button> -- panel/AGENTS.md
                              mandates @idento/ui primitives. Same
                              ghost/icon trigger composition as
                              ThemeSwitcher.tsx/LanguageSwitcher.tsx's own
                              DropdownMenuTrigger asChild + Button. */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("equipmentRowMenuLabel", { name: device.display_name })}
                            className="size-auto shrink-0 p-1.5 text-muted-foreground"
                          >
                            ⋯
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onRename(device)}>{t("equipmentRename")}</DropdownMenuItem>
                          {onEditAddress && device.kind === "network" ? (
                            <DropdownMenuItem onSelect={() => onEditAddress(device)}>
                              {t("equipmentEditAddress")}
                            </DropdownMenuItem>
                          ) : null}
                          {onDownloadPairingQr && device.kind === "network" ? (
                            <DropdownMenuItem onSelect={() => onDownloadPairingQr(device)}>
                              {t("equipmentDownloadPairingQr")}
                            </DropdownMenuItem>
                          ) : null}
                          {showDefaultControls ? (
                            <DropdownMenuItem
                              onSelect={() => (device.is_default ? onClearDefault(device) : onSetDefault(device))}
                            >
                              {t(device.is_default ? "equipmentClearDefault" : "equipmentSetDefault")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => onDelete(device)}>{t("equipmentDelete")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : null}
                </div>
              );
            })}
            {unsavedPrinters.map((printer) => (
              <div
                key={printer.name}
                data-testid={`equipment-device-unsaved-${printer.name}`}
                className="flex items-center gap-3 border-t border-border px-4 py-3"
              >
                <span data-testid={`equipment-device-dot-unsaved-${printer.name}`}>
                  <StatusPill status="ready" label={printer.name} variant="bare" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-bold text-foreground">{printer.name}</span>
                  <span className="font-mono text-caption text-muted-foreground">{printer.type}</span>
                </div>
                {onSaveUnsaved ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disableActions}
                    onClick={() => onSaveUnsaved(printer)}
                  >
                    {t("equipmentSaveDevice")}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled data-testid="wizard-todo">
                    {t("equipmentSaveDevice")}
                  </Button>
                )}
              </div>
            ))}
          </>
        )}
      </CardContent>
      <CardFooter>
        <p className="text-caption text-muted-foreground">{footerText}</p>
      </CardFooter>
    </Card>
  );
}
