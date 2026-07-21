// Defensive parser for GET /api/events/{id}/checkin-settings' `settings:
// object | null` -- turns it into a fully-populated CheckinSettings so the
// rest of desktop never re-checks for null/partial/malformed data.
export interface CheckinSettings {
  print_on_checkin: boolean;
  verdict_auto_dismiss_sec: number;
  scan_input: "wedge" | "scanner" | "manual";
  manual_search_enabled: boolean;
}

export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings = {
  print_on_checkin: true,
  verdict_auto_dismiss_sec: 4,
  scan_input: "wedge",
  manual_search_enabled: true,
};

const VALID_SCAN_INPUTS: ReadonlySet<string> = new Set<CheckinSettings["scan_input"]>([
  "wedge",
  "scanner",
  "manual",
]);

const MIN_DISMISS_SEC = 1;
const MAX_DISMISS_SEC = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCheckinSettings(raw: unknown): CheckinSettings {
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_CHECKIN_SETTINGS };
  }

  const print_on_checkin =
    typeof raw.print_on_checkin === "boolean" ? raw.print_on_checkin : DEFAULT_CHECKIN_SETTINGS.print_on_checkin;

  const manual_search_enabled =
    typeof raw.manual_search_enabled === "boolean"
      ? raw.manual_search_enabled
      : DEFAULT_CHECKIN_SETTINGS.manual_search_enabled;

  const scan_input =
    typeof raw.scan_input === "string" && VALID_SCAN_INPUTS.has(raw.scan_input)
      ? (raw.scan_input as CheckinSettings["scan_input"])
      : DEFAULT_CHECKIN_SETTINGS.scan_input;

  let verdict_auto_dismiss_sec = DEFAULT_CHECKIN_SETTINGS.verdict_auto_dismiss_sec;
  if (
    typeof raw.verdict_auto_dismiss_sec === "number" &&
    Number.isFinite(raw.verdict_auto_dismiss_sec) &&
    Number.isInteger(raw.verdict_auto_dismiss_sec)
  ) {
    verdict_auto_dismiss_sec = Math.min(
      MAX_DISMISS_SEC,
      Math.max(MIN_DISMISS_SEC, raw.verdict_auto_dismiss_sec),
    );
  }

  return { print_on_checkin, verdict_auto_dismiss_sec, scan_input, manual_search_enabled };
}
