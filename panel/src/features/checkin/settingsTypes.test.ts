import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKIN_SETTINGS, parseCheckinSettings } from "./settingsTypes";

describe("DEFAULT_CHECKIN_SETTINGS", () => {
  it("matches the board defaults", () => {
    expect(DEFAULT_CHECKIN_SETTINGS).toEqual({
      print_on_checkin: true,
      verdict_auto_dismiss_sec: 4,
      scan_input: "wedge",
      manual_search_enabled: true,
    });
  });
});

describe("parseCheckinSettings", () => {
  it("returns the defaults for null (event has never had settings saved)", () => {
    expect(parseCheckinSettings(null)).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("returns the defaults for undefined", () => {
    expect(parseCheckinSettings(undefined)).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("returns the defaults for a non-object value", () => {
    expect(parseCheckinSettings("nonsense")).toEqual(DEFAULT_CHECKIN_SETTINGS);
    expect(parseCheckinSettings(42)).toEqual(DEFAULT_CHECKIN_SETTINGS);
    expect(parseCheckinSettings([])).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("returns the defaults for an empty object", () => {
    expect(parseCheckinSettings({})).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("fills in per-field defaults for a partial object, keeping the fields that ARE present", () => {
    expect(parseCheckinSettings({ print_on_checkin: false })).toEqual({
      ...DEFAULT_CHECKIN_SETTINGS,
      print_on_checkin: false,
    });
    expect(parseCheckinSettings({ scan_input: "scanner" })).toEqual({
      ...DEFAULT_CHECKIN_SETTINGS,
      scan_input: "scanner",
    });
    expect(parseCheckinSettings({ manual_search_enabled: false })).toEqual({
      ...DEFAULT_CHECKIN_SETTINGS,
      manual_search_enabled: false,
    });
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 10 })).toEqual({
      ...DEFAULT_CHECKIN_SETTINGS,
      verdict_auto_dismiss_sec: 10,
    });
  });

  it("falls back to the per-field default when a field has the wrong type", () => {
    expect(
      parseCheckinSettings({
        print_on_checkin: "yes",
        verdict_auto_dismiss_sec: "4",
        scan_input: 7,
        manual_search_enabled: "no",
      }),
    ).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("falls back to the default scan_input for an unrecognized enum value", () => {
    expect(parseCheckinSettings({ scan_input: "camera" })).toEqual(DEFAULT_CHECKIN_SETTINGS);
  });

  it("accepts every valid scan_input value verbatim", () => {
    expect(parseCheckinSettings({ scan_input: "wedge" }).scan_input).toBe("wedge");
    expect(parseCheckinSettings({ scan_input: "scanner" }).scan_input).toBe("scanner");
    expect(parseCheckinSettings({ scan_input: "manual" }).scan_input).toBe("manual");
  });

  // The backend's own PUT validation (openapi's putCheckinSettings 400 rule)
  // enforces verdict_auto_dismiss_sec is an integer in 1..30, so an
  // out-of-range value can only reach this parser via a hand-edited DB row
  // or a future relaxation of that rule — still, a defensive client parser
  // must not blow up or silently accept it. Judgment call (documented in
  // settingsTypes.ts): CLAMP to the valid 1..30 range rather than discard to
  // the default, since a clamp preserves the operator's evident intent (e.g.
  // "as long as possible" for a huge value) better than silently resetting
  // to 4.
  it("clamps an out-of-range verdict_auto_dismiss_sec to the nearest bound (1..30)", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 0 }).verdict_auto_dismiss_sec).toBe(1);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: -5 }).verdict_auto_dismiss_sec).toBe(1);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 31 }).verdict_auto_dismiss_sec).toBe(30);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 1000 }).verdict_auto_dismiss_sec).toBe(30);
  });

  it("preserves an in-range verdict_auto_dismiss_sec, including the boundary values", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 1 }).verdict_auto_dismiss_sec).toBe(1);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 30 }).verdict_auto_dismiss_sec).toBe(30);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: 15 }).verdict_auto_dismiss_sec).toBe(15);
  });

  it("falls back to the default for a non-finite verdict_auto_dismiss_sec (NaN/Infinity)", () => {
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: NaN }).verdict_auto_dismiss_sec).toBe(4);
    expect(parseCheckinSettings({ verdict_auto_dismiss_sec: Infinity }).verdict_auto_dismiss_sec).toBe(4);
  });

  it("ignores unknown extra fields rather than throwing", () => {
    expect(parseCheckinSettings({ print_on_checkin: false, mystery: "field" })).toEqual({
      ...DEFAULT_CHECKIN_SETTINGS,
      print_on_checkin: false,
    });
  });
});
