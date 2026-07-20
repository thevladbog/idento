import { deviceMetaLine } from "./deviceMeta";
import type { EquipmentDevice } from "./hooks";

function device(overrides: Partial<EquipmentDevice> & Pick<EquipmentDevice, "class" | "kind">): EquipmentDevice {
  return {
    id: "dev-1",
    display_name: "Test device",
    config: {},
    is_default: false,
    test_passed_at: null,
    last_seen_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("deviceMetaLine", () => {
  it("formats a network printer with dpi", () => {
    const d = device({
      class: "printer",
      kind: "network",
      config: { agent_name: "Network_192_168_1_44", ip: "192.168.1.44", port: 9100, dpi: 300 },
    });
    expect(deviceMetaLine(d)).toBe("network · 192.168.1.44:9100 · 300 dpi");
  });

  it("formats a network printer without dpi (omits the dpi segment, doesn't fabricate one)", () => {
    const d = device({
      class: "printer",
      kind: "network",
      config: { agent_name: "Network_192_168_1_44", ip: "192.168.1.44", port: 9100 },
    });
    expect(deviceMetaLine(d)).toBe("network · 192.168.1.44:9100");
  });

  it("formats a system printer by its agent_name", () => {
    const d = device({ class: "printer", kind: "system", config: { agent_name: "HP_Smart_Tank_790" } });
    expect(deviceMetaLine(d)).toBe("system · HP_Smart_Tank_790");
  });

  it("formats a USB wedge scanner with the Enter terminator label", () => {
    const d = device({ class: "scanner", kind: "usb_wedge", config: { terminator: "enter" } });
    expect(deviceMetaLine(d)).toBe("USB-HID · keyboard wedge · Enter");
  });

  it("formats a USB wedge scanner with the Tab terminator label", () => {
    const d = device({ class: "scanner", kind: "usb_wedge", config: { terminator: "tab" } });
    expect(deviceMetaLine(d)).toBe("USB-HID · keyboard wedge · Tab");
  });

  it("formats a USB wedge scanner with the none terminator as an em dash", () => {
    const d = device({ class: "scanner", kind: "usb_wedge", config: { terminator: "none" } });
    expect(deviceMetaLine(d)).toBe("USB-HID · keyboard wedge · —");
  });

  it("formats a COM scanner by its port_name", () => {
    const d = device({ class: "scanner", kind: "com", config: { port_name: "COM3" } });
    expect(deviceMetaLine(d)).toBe("COM · COM3");
  });

  it("falls back to an em dash for missing config fields instead of throwing", () => {
    const d = device({ class: "printer", kind: "system", config: {} });
    expect(deviceMetaLine(d)).toBe("system · —");
  });

  it("falls back to a bare em dash for a class/kind combination it doesn't recognize (e.g. reserved camera)", () => {
    const d = device({ class: "camera", kind: "system", config: {} });
    expect(deviceMetaLine(d)).toBe("—");
  });
});
