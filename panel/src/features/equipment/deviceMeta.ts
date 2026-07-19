import type { EquipmentDevice } from "./hooks";

// Board 5a's mono meta line per device kind (p4.3-board-5a-5d-extract.md):
// "network · 192.168.1.44:9100 · 300 dpi", "USB-HID · keyboard wedge ·
// suffix: Enter", etc. Deliberately NOT i18n'd (like every other mono/
// monospace technical fact on this page — ip:port, agent_name, port_name)
// -- these are literal device facts, not prose, and stay identical in both
// locales (task-7-brief.md's `deviceMetaLine(device): string` signature
// takes no `t`). `config` is a loose object (schema.d.ts), so every read is
// defensive, same idiom as reconcile.ts.
const TERMINATOR_LABELS: Record<string, string> = {
  enter: "Enter",
  tab: "Tab",
  none: "—",
};

const FALLBACK = "—";

function configString(device: EquipmentDevice, key: string): string | undefined {
  const value = device.config?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/**
 * The mono meta line for a saved device row (board 5a): network printer
 * ⇒ `network · {ip}:{port}[ · {dpi} dpi]` (dpi omitted when not configured);
 * system printer ⇒ `system · {agent_name}`; USB wedge scanner ⇒
 * `USB-HID · keyboard wedge · {terminator}` (Enter/Tab/— per
 * TERMINATOR_LABELS); COM scanner ⇒ `COM · {port_name}`. Any other class/
 * kind combination (camera, reserved and not yet creatable) falls back to
 * a bare "—" rather than throwing.
 */
export function deviceMetaLine(device: EquipmentDevice): string {
  if (device.class === "printer") {
    if (device.kind === "network") {
      const ip = configString(device, "ip") ?? FALLBACK;
      const port = configString(device, "port") ?? FALLBACK;
      const dpi = configString(device, "dpi");
      return dpi != null ? `network · ${ip}:${port} · ${dpi} dpi` : `network · ${ip}:${port}`;
    }
    return `system · ${configString(device, "agent_name") ?? FALLBACK}`;
  }
  if (device.class === "scanner") {
    if (device.kind === "usb_wedge") {
      const terminator = configString(device, "terminator");
      const label = terminator ? (TERMINATOR_LABELS[terminator] ?? terminator) : FALLBACK;
      return `USB-HID · keyboard wedge · ${label}`;
    }
    if (device.kind === "com") {
      return `COM · ${configString(device, "port_name") ?? FALLBACK}`;
    }
  }
  return FALLBACK;
}
