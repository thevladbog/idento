import type { AgentPrinter, AgentScanner } from "../../shared/agent/agentClient";
import type { EquipmentDevice } from "./hooks";

// Pure client-side matching between the registry (EquipmentDevice rows,
// P4.3 spec §4.1) and the live agent's currently-reported printers/scanners
// (spec §5.2's "Device columns" + "Reconcile-on-load" rules). No IO here —
// Task 7's hub page owns the actual /printers, /scanners, and machine-query
// fetches; this module only combines already-fetched lists, so it's plain
// unit-testable array logic (reconcile.test.ts).
//
// Matching key is ALWAYS the agent-side identity field inside `config`
// (`agent_name` for printers, `port_name` for com scanners) — NEVER
// `display_name`, which is user-renameable and therefore not a stable link
// (EquipmentDevice's schema doc comment, spec §4.1). `config` is typed as a
// loose object in the generated schema (validated server-side instead), so
// every read here is defensive: `device.config?.field as string | undefined`.

export type Liveness = "live" | "not_seen" | "none";

/**
 * Per-device liveness against the currently-fetched agent lists.
 * - class="printer" (kind system|network): "live" iff some agent printer's
 *   `name` equals this device's `config.agent_name`; otherwise "not_seen".
 * - class="scanner", kind="com": "live" iff some agent scanner's
 *   `port_name` equals this device's `config.port_name`; otherwise
 *   "not_seen".
 * - class="scanner", kind="usb_wedge": ALWAYS "none" — a wedge scanner is a
 *   browser-side input method (keydown capture) the agent has no
 *   visibility into at all; there is no live/not_seen distinction to make
 *   honestly here (spec §5.2's "honesty rule" — showing a dot would be a
 *   fabrication).
 * - anything else (class="camera", reserved and not yet creatable) also
 *   resolves to "none" — no agent-reported presence signal exists for it
 *   either, and this function must not throw on it.
 */
export function deviceLiveness(device: EquipmentDevice, printers: AgentPrinter[], scanners: AgentScanner[]): Liveness {
  if (device.class === "printer") {
    const agentName = device.config?.agent_name as string | undefined;
    return agentName != null && printers.some((printer) => printer.name === agentName) ? "live" : "not_seen";
  }
  if (device.class === "scanner" && device.kind === "com") {
    const portName = device.config?.port_name as string | undefined;
    return portName != null && scanners.some((scanner) => scanner.port_name === portName) ? "live" : "not_seen";
  }
  return "none";
}

/**
 * Device ids to report as `seen_device_ids` on the machine-upsert PUT
 * (spec §5.2's "Reconcile-on-load"). Only ids with a "live" verdict —
 * wedge scanners (and anything else `deviceLiveness` resolves to "none")
 * are NEVER included, even though they may in fact still be physically
 * attached: the agent literally cannot observe them, so reporting them as
 * "seen" would be reporting something this client didn't actually see.
 */
export function computeSeenDeviceIds(
  devices: EquipmentDevice[],
  printers: AgentPrinter[],
  scanners: AgentScanner[],
): string[] {
  return devices.filter((device) => deviceLiveness(device, printers, scanners) === "live").map((device) => device.id);
}

/**
 * Live agent printers with no matching registry row — matched the same way
 * as `deviceLiveness` (registry `config.agent_name` vs. agent `name`), only
 * over the registry's printer-class devices (a scanner device's config
 * never carries `agent_name`, but the check is scoped by class regardless,
 * defensively). This is the hub's "unsaved" row / discovery-into-the-
 * registry affordance (spec §5.2: "live agent printers NOT in the registry
 * ... appear as unsaved rows with a Save… affordance").
 */
export function unsavedLivePrinters(devices: EquipmentDevice[], printers: AgentPrinter[]): AgentPrinter[] {
  const registeredAgentNames = new Set(
    devices
      .filter((device) => device.class === "printer")
      .map((device) => device.config?.agent_name as string | undefined)
      .filter((agentName): agentName is string => agentName != null),
  );
  return printers.filter((printer) => !registeredAgentNames.has(printer.name));
}
