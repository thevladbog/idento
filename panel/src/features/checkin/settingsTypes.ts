// Hand-written check-in settings type + defensive parser (P4.1 Task 5) —
// mirrors badge/templateTypes.ts's parseTemplateDoc shape (isPlainObject +
// per-field type narrowing with a default fallback), but for the much
// simpler CheckinSettings shape (schema.d.ts's CheckinSettings — all four
// fields required server-side, stored verbatim in events.checkin_settings).
//
// GET /api/events/{id}/checkin-settings returns `{settings: CheckinSettings
// | null}` — null when the event has never had settings saved (see
// CheckinSettingsResponse's own schema.d.ts comment). This parser's job is
// to turn that `settings` value (or anything else that reaches it) into a
// fully-populated CheckinSettings the rest of the panel can rely on without
// re-checking for null/partial/malformed data at every call site.

export interface CheckinSettings {
  print_on_checkin: boolean;
  verdict_auto_dismiss_sec: number;
  scan_input: "wedge" | "scanner" | "manual";
  manual_search_enabled: boolean;
}

// The board's default settings for an event that has never saved any (board
// 2a) — also what the launch ceremony (Task 11) pre-fills its settings form
// with before the operator's first save.
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

// Mirrors the backend's own PUT validation (openapi.yaml's putCheckinSettings
// 400 rule, schema.d.ts:2806): verdict_auto_dismiss_sec must be an integer in
// 1..30. Every value this panel itself ever PUTs already satisfies this (the
// settings form clamps its own input), so an out-of-range value reaching
// parseCheckinSettings can only come from a hand-edited DB row, a future
// relaxation of the backend rule, or a test fixture — not normal operation.
const MIN_DISMISS_SEC = 1;
const MAX_DISMISS_SEC = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Defensively narrows the server's `settings: object | null` (or any other
// `unknown` — this is deliberately the widest possible input type) into a
// fully-populated CheckinSettings. Every field falls back to
// DEFAULT_CHECKIN_SETTINGS' value INDEPENDENTLY of the others (a partial
// object keeps whichever fields it DOES have) — a wrong-typed or missing
// field never invalidates the fields around it.
//
// Judgment call for out-of-range verdict_auto_dismiss_sec (documented in the
// "task-5-brief.md" as "clamp-or-default, implementer's choice"): this
// parser CLAMPS to the 1..30 bound rather than discarding to the default.
// Reasoning: a clamp preserves the operator's evident intent (a value like
// 1000 clearly means "as long as possible", not "unset") strictly better
// than silently resetting to 4, and it's the same posture PUT validation
// takes server-side conceptually (reject only what can't be made sensible —
// here, "sensible" is trivial: clamp to the nearest legal bound). A
// non-finite number (NaN/Infinity) still falls back to the default, since
// there's no sensible bound to clamp NaN toward.
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
    // PR #77 bot-review round, Finding O -- the backend contract requires an
    // INTEGER (openapi.yaml's putCheckinSettings 400 rule). A fractional
    // value (e.g. 4.5, from a hand-edited DB row) previously survived the
    // finite check above and was merely clamped, letting a fraction reach
    // timer math (useCheckinFlow.ts's `verdict_auto_dismiss_sec * 1000`).
    // Same fallback-to-default behavior as any other invalid case this
    // parser already handles -- discard, don't round/truncate (rounding
    // would silently invent a value the operator never actually set).
    Number.isInteger(raw.verdict_auto_dismiss_sec)
  ) {
    verdict_auto_dismiss_sec = Math.min(
      MAX_DISMISS_SEC,
      Math.max(MIN_DISMISS_SEC, raw.verdict_auto_dismiss_sec),
    );
  }

  return { print_on_checkin, verdict_auto_dismiss_sec, scan_input, manual_search_enabled };
}
