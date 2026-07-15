import type { CsvEncoding } from "./encoding";

// Full contract for the 3-step CSV import wizard (Tasks 11-13). Task 11
// (this file's first version) only reads/writes step/file/buffer/encoding/
// encodingOverridden/rows/headers — mapping/importProgress/rowErrors are
// defined now so Tasks 12-13 extend a stable shape instead of widening it
// mid-flight, but they stay empty/undefined until those tasks populate them.
export type MappingTarget =
  | { kind: "standard"; field: "first_name" | "last_name" | "email" | "company" | "position" | "code" }
  | { kind: "custom"; name: string }
  | { kind: "skip" }
  | { kind: "unset" };

export interface ImportWizardState {
  step: 1 | 2 | 3;
  file?: File;
  buffer?: ArrayBuffer;
  encoding: CsvEncoding;
  encodingOverridden: boolean;
  rows: Record<string, string>[];
  headers: string[];
  mapping: Record<string, MappingTarget>;
  importProgress?: { done: number; total: number };
  rowErrors?: Array<{ row: number; data: string; problem: string }>;
}

// Fresh state for a newly (re)opened wizard — always starts at step 1 with
// no file yet. utf-8 is just a starting default for the `encoding` field
// (not a claim about the eventual file); it's overwritten by the real
// `detectEncoding` result as soon as a file is picked, before it's ever read.
export function createInitialWizardState(): ImportWizardState {
  return {
    step: 1,
    encoding: "utf-8",
    encodingOverridden: false,
    rows: [],
    headers: [],
    mapping: {},
  };
}

export type StandardField = Extract<MappingTarget, { kind: "standard" }>["field"];

// Board 3b's default-mapping heuristic: case-insensitive substring match
// against each header, first rule to match wins. The last_name rule is
// checked BEFORE the first_name rule on purpose — an English "Last name"
// header contains the substring "name", which would otherwise be claimed by
// first_name's broader needle list first. When no rule matches, the column
// defaults to `unset` (never `skip`) so the operator has to make an
// explicit accept/skip decision before importing — see the wizard's
// must-acknowledge behavior for unmapped columns.
const MAPPING_HEURISTICS: Array<{ needles: string[]; field: StandardField }> = [
  { needles: ["фамилия", "last"], field: "last_name" },
  { needles: ["имя", "name", "фио"], field: "first_name" },
  { needles: ["email", "почта", "e-mail"], field: "email" },
  { needles: ["компания", "company", "организация"], field: "company" },
  { needles: ["должность", "position", "role"], field: "position" },
  { needles: ["код", "code"], field: "code" },
];

export function computeDefaultMapping(headers: string[]): Record<string, MappingTarget> {
  const mapping: Record<string, MappingTarget> = {};
  for (const header of headers) {
    const lower = header.toLowerCase();
    const rule = MAPPING_HEURISTICS.find((h) => h.needles.some((needle) => lower.includes(needle)));
    mapping[header] = rule ? { kind: "standard", field: rule.field } : { kind: "unset" };
  }
  return mapping;
}

// In-file dedup by email, keep-first — this is the "duplicates merged by
// email" behavior board 3b states as automatic at the mapping step (a
// silent same-file merge), distinct from the against-existing-list
// duplicate flagging shown at step 3 (Task 13). Comparison is
// case-insensitive and blank/whitespace-only email values are never treated
// as duplicates of each other (every blank-email row is kept).
export function dedupeByEmail(
  rows: Record<string, string>[],
  emailColumnHeader: string | undefined,
): { deduped: Record<string, string>[]; mergedCount: number } {
  if (!emailColumnHeader) {
    return { deduped: rows, mergedCount: 0 };
  }
  const seen = new Set<string>();
  const deduped: Record<string, string>[] = [];
  let mergedCount = 0;
  for (const row of rows) {
    const email = (row[emailColumnHeader] ?? "").trim().toLowerCase();
    if (email === "") {
      deduped.push(row);
      continue;
    }
    if (seen.has(email)) {
      mergedCount += 1;
      continue;
    }
    seen.add(email);
    deduped.push(row);
  }
  return { deduped, mergedCount };
}

export interface BulkPayload {
  attendees: Record<string, unknown>[];
  field_schema: string[];
  mergedDuplicates: number;
}

// Builds the bulk-import payload Task 13 will submit: one attendee object
// per (deduped) row, keyed by each mapped column's target key — the
// standard field name for `standard` mappings, the operator-chosen name for
// `custom` mappings. `skip`/`unset` columns contribute nothing. `headers`
// isn't a separate parameter (matching the brief's exact signature): column
// order is read off `Object.keys(mapping)`, which reflects header order
// because callers always build `mapping` by iterating `state.headers` in
// order (see computeDefaultMapping above and ImportWizard's mapping-change
// handler, which only ever adds/overwrites existing header keys).
export function buildBulkPayload(
  rows: Record<string, string>[],
  mapping: Record<string, MappingTarget>,
): BulkPayload {
  const headers = Object.keys(mapping);
  const columnKeys = headers.map((header) => {
    const target = mapping[header];
    if (target.kind === "standard") return { header, key: target.field as string };
    if (target.kind === "custom") return { header, key: target.name };
    return null;
  });

  const emailHeader = headers.find((header) => {
    const target = mapping[header];
    return target.kind === "standard" && target.field === "email";
  });
  const { deduped, mergedCount } = dedupeByEmail(rows, emailHeader);

  const fieldSchema: string[] = [];
  const seenKeys = new Set<string>();
  const attendees = deduped.map((row) => {
    const attendee: Record<string, unknown> = {};
    for (const entry of columnKeys) {
      if (!entry) continue;
      const value = row[entry.header];
      if (value === undefined) continue;
      attendee[entry.key] = value;
      if (!seenKeys.has(entry.key)) {
        seenKeys.add(entry.key);
        fieldSchema.push(entry.key);
      }
    }
    return attendee;
  });

  return { attendees, field_schema: fieldSchema, mergedDuplicates: mergedCount };
}
