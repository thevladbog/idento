import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

// UTF-8 BOM — without it Excel guesses the wrong codepage for a
// pure-UTF-8-encoded CSV and mangles Cyrillic (and other non-ASCII) text.
// Exported so other CSV builders in this feature (e.g. the import wizard's
// failed-rows download, Task 13) prefix the same BOM without redefining it.
export const BOM = "﻿";

// Mirrors the backend's formula-injection guard (sanitizeCSVField, see the
// P2.1 plan's Verified facts): any value starting with =, +, -, @, a tab,
// or a carriage return gets a leading apostrophe before normal CSV quoting
// is applied, so Excel/Sheets render it as inert text instead of evaluating
// it as a formula (e.g. a custom-field value of `=cmd|'/c calc'!A1`). This
// is a real security control (CVE-class "CSV injection"), not decorative —
// order matters: prefix first, THEN decide whether the (now-prefixed)
// value needs standard CSV quoting.
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;
const NEEDS_QUOTING_RE = /[",\n\r]/;

export function sanitizeCsvField(raw: string): string {
  let value = raw;
  if (FORMULA_TRIGGER_RE.test(value)) {
    value = `'${value}`;
  }
  if (NEEDS_QUOTING_RE.test(value)) {
    value = `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function checkedInLabel(attendee: Attendee): string {
  return attendee.checkin_status ? "yes" : "no";
}

// Column headers are plain literals, not i18n keys: a CSV is a data
// interchange format read by Excel/Sheets/re-import tooling, not app UI
// chrome — the task brief's exhaustive i18n key list (bulkSelected,
// bulkAssignZone, ...) deliberately does not include any CSV-header keys.
const BASE_COLUMNS: { header: string; get: (attendee: Attendee) => string }[] = [
  { header: "First name", get: (a) => a.first_name },
  { header: "Last name", get: (a) => a.last_name },
  { header: "Email", get: (a) => a.email },
  { header: "Company", get: (a) => a.company },
  { header: "Position", get: (a) => a.position },
  { header: "Code", get: (a) => a.code },
  { header: "Checked in", get: checkedInLabel },
];

// Union of every custom_fields key present across the selected rows, in
// first-seen order — not every row has every key, so a row missing a given
// key gets an empty cell for that column (never a fabricated value).
function customFieldKeys(rows: Attendee[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.custom_fields ?? {})) keys.add(key);
  }
  return [...keys];
}

function customFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

// Pure CSV builder, the part worth unit-testing directly in isolation from
// the DOM/Blob download side effect below.
export function buildAttendeesCsv(rows: Attendee[]): string {
  const customKeys = customFieldKeys(rows);
  const headerRow = [...BASE_COLUMNS.map((c) => c.header), ...customKeys].map(sanitizeCsvField).join(",");
  const dataRows = rows.map((row) => {
    const baseValues = BASE_COLUMNS.map((c) => sanitizeCsvField(c.get(row)));
    const customValues = customKeys.map((key) => sanitizeCsvField(customFieldValue(row.custom_fields?.[key])));
    return [...baseValues, ...customValues].join(",");
  });
  return BOM + [headerRow, ...dataRows].join("\r\n");
}

// The Blob + URL.createObjectURL + temporary-anchor-click download side
// effect, extracted so it's shared verbatim by exportAttendeesCsv below and
// the import wizard's failed-rows download (Task 13) rather than
// reimplemented a second time. Deliberately never navigates the page or
// uses window.open, either of which would either replace the SPA or get
// blocked as an unsolicited popup.
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// Client-side-only export (no network call): builds the CSV from the
// already-in-memory selected rows and triggers a download via downloadCsv.
export function exportAttendeesCsv(rows: Attendee[], filename = "attendees.csv"): void {
  downloadCsv(buildAttendeesCsv(rows), filename);
}
