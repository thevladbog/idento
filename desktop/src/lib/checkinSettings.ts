export const KIOSK_CHECKIN_SETTINGS_KEY = "kiosk_checkin_settings";

export type KioskCheckinSettings = {
  checkinMode: "camera" | "scanner";
  printEnabled: boolean;
  manualPrint: boolean;
};

const defaultCheckinSettings: KioskCheckinSettings = {
  checkinMode: "scanner",
  printEnabled: false,
  manualPrint: false,
};

export function loadCheckinSettings(): KioskCheckinSettings {
  try {
    const raw = localStorage.getItem(KIOSK_CHECKIN_SETTINGS_KEY);
    if (!raw) return defaultCheckinSettings;
    const parsed = JSON.parse(raw) as Partial<KioskCheckinSettings>;
    return {
      checkinMode: parsed.checkinMode === "camera" ? "camera" : "scanner",
      printEnabled: Boolean(parsed.printEnabled),
      manualPrint: Boolean(parsed.manualPrint),
    };
  } catch {
    return defaultCheckinSettings;
  }
}

export function saveCheckinSettings(s: KioskCheckinSettings): void {
  localStorage.setItem(KIOSK_CHECKIN_SETTINGS_KEY, JSON.stringify(s));
}
