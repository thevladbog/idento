import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKIN_SETTINGS, parseCheckinSettings } from "./settingsTypes";

describe("parseCheckinSettings", () => {
  it("returns defaults for null", () => {
    expect(parseCheckinSettings(null)).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("returns defaults for a non-object", () => {
    expect(parseCheckinSettings("nope")).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("keeps valid fields, falls back per-field for invalid ones", () => {
    const result = parseCheckinSettings({
      print_on_checkin: false,
      verdict_auto_dismiss_sec: "not a number",
      scan_input: "scanner",
      manual_search_enabled: true,
    });
    expect(result).toEqual({
      print_on_checkin: false,
      verdict_auto_dismiss_sec: DEFAULT_CHECKIN_SETTINGS.verdict_auto_dismiss_sec,
      scan_input: "scanner",
      manual_search_enabled: true,
    });
  });

  it("rejects an invalid scan_input value, falls back to default", () => {
    expect(parseCheckinSettings({ scan_input: "camera" }).scan_input).toBe(DEFAULT_CHECKIN_SETTINGS.scan_input);
  });

  it("clamps verdict_auto_dismiss_sec to the 1..30 bound rather than discarding", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 1000 }).verdict_auto_dismiss_sec).toBe(30);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: -5 }).verdict_auto_dismiss_sec).toBe(1);
  });

  it("discards (not rounds) a fractional verdict_auto_dismiss_sec", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 4.5 }).verdict_auto_dismiss_sec).toBe(
      DEFAULT_CHECKIN_SETTINGS.verdict_auto_dismiss_sec,
    );
  });
});
