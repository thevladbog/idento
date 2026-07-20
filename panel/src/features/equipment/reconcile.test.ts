// P4.3 Task 6 -- pure reconcile-matching tests (spec §5.2's "Device columns"
// + "Reconcile-on-load" rules). No IO, no MSW: these exercise reconcile.ts's
// straight array logic against hand-built AgentPrinter/AgentScanner/
// EquipmentDevice fixtures.
import { describe, expect, it } from "vitest";
import type { AgentPrinter, AgentScanner } from "../../shared/agent/agentClient";
import type { EquipmentDevice } from "./hooks";
import { computeSeenDeviceIds, deviceLiveness, unsavedLivePrinters } from "./reconcile";

function device(
  overrides: Partial<EquipmentDevice> & Pick<EquipmentDevice, "id" | "class" | "kind" | "config">,
): EquipmentDevice {
  return {
    display_name: "Device",
    is_default: false,
    test_passed_at: null,
    last_seen_at: null,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

const printers: AgentPrinter[] = [
  { name: "HP_Smart_Tank_790", type: "system" },
  { name: "Network_192_168_0_10", type: "network" },
];

const scanners: AgentScanner[] = [{ name: "Scanner_COM3", port_name: "COM3" }];

describe("deviceLiveness", () => {
  it("is live for a printer whose config.agent_name matches a live agent printer", () => {
    const d = device({ id: "d1", class: "printer", kind: "system", config: { agent_name: "HP_Smart_Tank_790" } });
    expect(deviceLiveness(d, printers, scanners)).toBe("live");
  });

  it("is not_seen for a printer whose config.agent_name has no live match", () => {
    const d = device({ id: "d1", class: "printer", kind: "system", config: { agent_name: "Missing_Printer" } });
    expect(deviceLiveness(d, printers, scanners)).toBe("not_seen");
  });

  it("matches a network printer by config.agent_name the same way as a system printer", () => {
    const d = device({
      id: "d1",
      class: "printer",
      kind: "network",
      config: { agent_name: "Network_192_168_0_10", ip: "192.168.0.10", port: 9100 },
    });
    expect(deviceLiveness(d, printers, scanners)).toBe("live");
  });

  it("is live for a com scanner whose config.port_name matches a live agent scanner", () => {
    const d = device({ id: "d2", class: "scanner", kind: "com", config: { port_name: "COM3" } });
    expect(deviceLiveness(d, printers, scanners)).toBe("live");
  });

  it("is not_seen for a com scanner whose config.port_name has no live match", () => {
    const d = device({ id: "d2", class: "scanner", kind: "com", config: { port_name: "COM9" } });
    expect(deviceLiveness(d, printers, scanners)).toBe("not_seen");
  });

  it("is none for a wedge scanner regardless of registry/agent state -- no observable liveness (the honesty rule)", () => {
    const d = device({ id: "d3", class: "scanner", kind: "usb_wedge", config: { terminator: "enter" } });
    expect(deviceLiveness(d, printers, scanners)).toBe("none");
  });

  it("is none for a wedge scanner even when its display_name happens to equal a live printer's agent_name", () => {
    const d = device({
      id: "d3",
      class: "scanner",
      kind: "usb_wedge",
      display_name: "HP_Smart_Tank_790",
      config: { terminator: "enter" },
    });
    expect(deviceLiveness(d, printers, scanners)).toBe("none");
  });

  it("never treats display_name as the matching key -- a printer renamed away from its agent_name still matches by agent_name", () => {
    const d = device({
      id: "d1",
      class: "printer",
      kind: "system",
      display_name: "Front Desk Printer",
      config: { agent_name: "HP_Smart_Tank_790" },
    });
    expect(deviceLiveness(d, printers, scanners)).toBe("live");
  });

  it("does not match a printer by display_name when it happens to equal a live printer's agent_name but config.agent_name differs", () => {
    const d = device({
      id: "d1",
      class: "printer",
      kind: "system",
      display_name: "HP_Smart_Tank_790",
      config: { agent_name: "Some_Other_Printer" },
    });
    expect(deviceLiveness(d, printers, scanners)).toBe("not_seen");
  });

  it("is not_seen (not a crash) when config is missing the expected key", () => {
    const d = device({ id: "d1", class: "printer", kind: "system", config: {} });
    expect(deviceLiveness(d, printers, scanners)).toBe("not_seen");
  });

  it("is none for a reserved camera device (no observable presence signal exists for it either)", () => {
    // camera creation is rejected server-side today, but the schema still
    // reserves class="camera" -- deviceLiveness must not throw on it.
    const d = device({ id: "d4", class: "camera", kind: "system", config: {} });
    expect(deviceLiveness(d, printers, scanners)).toBe("none");
  });
});

describe("computeSeenDeviceIds", () => {
  it("returns exactly the ids of live devices, in device order", () => {
    const livePrinter = device({
      id: "p-live",
      class: "printer",
      kind: "system",
      config: { agent_name: "HP_Smart_Tank_790" },
    });
    const deadPrinter = device({ id: "p-dead", class: "printer", kind: "system", config: { agent_name: "Missing" } });
    const liveScanner = device({ id: "s-live", class: "scanner", kind: "com", config: { port_name: "COM3" } });
    const wedge = device({ id: "s-wedge", class: "scanner", kind: "usb_wedge", config: { terminator: "enter" } });

    expect(computeSeenDeviceIds([livePrinter, deadPrinter, liveScanner, wedge], printers, scanners)).toEqual([
      "p-live",
      "s-live",
    ]);
  });

  it("never includes a wedge scanner's id, even as the only device", () => {
    const wedge = device({ id: "s-wedge", class: "scanner", kind: "usb_wedge", config: { terminator: "enter" } });
    expect(computeSeenDeviceIds([wedge], printers, scanners)).toEqual([]);
  });

  it("returns an empty array when nothing is live", () => {
    const deadPrinter = device({ id: "p-dead", class: "printer", kind: "system", config: { agent_name: "Missing" } });
    expect(computeSeenDeviceIds([deadPrinter], printers, scanners)).toEqual([]);
  });

  it("returns an empty array for an empty device list", () => {
    expect(computeSeenDeviceIds([], printers, scanners)).toEqual([]);
  });
});

describe("unsavedLivePrinters", () => {
  it("excludes agent printers already matched by a registry device's config.agent_name", () => {
    const saved = device({ id: "p1", class: "printer", kind: "system", config: { agent_name: "HP_Smart_Tank_790" } });
    expect(unsavedLivePrinters([saved], printers)).toEqual([{ name: "Network_192_168_0_10", type: "network" }]);
  });

  it("includes every live agent printer when the registry has no printer devices at all", () => {
    expect(unsavedLivePrinters([], printers)).toEqual(printers);
  });

  it("does not let a scanner device's config accidentally suppress a printer match (different config key)", () => {
    const scannerDevice = device({ id: "s1", class: "scanner", kind: "com", config: { port_name: "COM3" } });
    expect(unsavedLivePrinters([scannerDevice], printers)).toEqual(printers);
  });

  it("returns an empty array when every live printer is already registered", () => {
    const saved1 = device({ id: "p1", class: "printer", kind: "system", config: { agent_name: "HP_Smart_Tank_790" } });
    const saved2 = device({
      id: "p2",
      class: "printer",
      kind: "network",
      config: { agent_name: "Network_192_168_0_10" },
    });
    expect(unsavedLivePrinters([saved1, saved2], printers)).toEqual([]);
  });
});
