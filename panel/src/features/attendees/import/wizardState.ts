import { BOM, sanitizeCsvField } from "../exportCsv";
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

// Task 13: `row` is the ABSOLUTE 1-based file row (already mapped from the
// backend's chunk-relative row via mapChunkRowToAbsolute below — never the
// raw chunk-relative number). `problem` is BulkRowError's stable enum
// string ("duplicate_email" | "duplicate_code" | "create_failed"), kept as
// `string` here (not the literal union) so a future backend problem code
// this frontend doesn't yet know about degrades to an unrecognized-but-not-
// crashing row rather than a type error.
export interface RowError {
  row: number;
  data: string;
  problem: string;
}

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
  rowErrors?: RowError[];
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
//
// Fix 4 (CodeRabbit, PR #65): removing rows re-indexes the survivors, so a
// post-dedup position no longer matches the row's actual position in the
// operator's source file the moment any EARLIER row was dropped. `originalIndices[i]`
// is `deduped[i]`'s 1-based position in the ORIGINAL (pre-dedup) `rows`
// array — parallel to `deduped`, threaded through `buildBulkPayload` below
// so error rows can be reported/looked-up by the file position the operator
// actually sees when they open their CSV, not an internal post-dedup index.
export function dedupeByEmail(
  rows: Record<string, string>[],
  emailColumnHeader: string | undefined,
): { deduped: Record<string, string>[]; mergedCount: number; originalIndices: number[] } {
  if (!emailColumnHeader) {
    return { deduped: rows, mergedCount: 0, originalIndices: rows.map((_, i) => i + 1) };
  }
  const seen = new Set<string>();
  const deduped: Record<string, string>[] = [];
  const originalIndices: number[] = [];
  let mergedCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[emailColumnHeader] ?? "").trim().toLowerCase();
    if (email === "") {
      deduped.push(row);
      originalIndices.push(i + 1);
      continue;
    }
    if (seen.has(email)) {
      mergedCount += 1;
      continue;
    }
    seen.add(email);
    deduped.push(row);
    originalIndices.push(i + 1);
  }
  return { deduped, mergedCount, originalIndices };
}

// Fix 1 (CodeRabbit, PR #65): `buildBulkPayload`'s row-building loop
// (`attendee[entry.key] = value`) silently lets the LAST header processed
// for a given target key win when two headers collide — no error, no
// indication, just quiet data loss for every earlier-processed column. This
// is the guard: it returns the PROBLEM HEADER NAMES (not localized
// messages — the UI layer localizes) that must be fixed BEFORE
// `buildBulkPayload`'s output can be trusted, so the caller (ImportWizard's
// Step2Body) can block the "Import N rows" action instead of silently
// losing data. `buildBulkPayload` itself stays a "trust the input is
// valid" pure function — its existing last-write-wins behavior for
// already-invalid input is unchanged (see the dedicated test in
// wizardState.test.ts documenting that assumption).
//
// A header is flagged when EITHER:
//   (a) it's a `custom` target whose `name` is blank/whitespace-only, or
//   (b) its target key (the standard field name, or the trimmed custom
//       name) collides with ANOTHER header's target key.
// `skip`/`unset` targets never participate — they contribute no key to
// `buildBulkPayload`'s output, so they can't collide with anything.
export function validateMapping(mapping: Record<string, MappingTarget>): string[] {
  const headers = Object.keys(mapping);
  const problemHeaders = new Set<string>();
  const headersByKey = new Map<string, string[]>();

  for (const header of headers) {
    const target = mapping[header];
    if (target.kind === "custom" && target.name.trim() === "") {
      problemHeaders.add(header);
      continue;
    }
    const key = target.kind === "standard" ? target.field : target.kind === "custom" ? target.name.trim() : null;
    if (key === null) continue;
    const headersForKey = headersByKey.get(key) ?? [];
    headersForKey.push(header);
    headersByKey.set(key, headersForKey);
  }

  for (const headersForKey of headersByKey.values()) {
    if (headersForKey.length > 1) {
      for (const header of headersForKey) problemHeaders.add(header);
    }
  }

  return headers.filter((header) => problemHeaders.has(header));
}

export interface BulkPayload {
  attendees: Record<string, unknown>[];
  field_schema: string[];
  mergedDuplicates: number;
  // Task 13: the raw (header-keyed, pre-transform) source row behind each
  // entry in `attendees`, same order/length — `attendees[i]` and
  // `dedupedRows[i]` are the SAME row, one mapped to field_schema keys, one
  // still in its original CSV-header shape. Step 3's "download failed rows
  // as CSV" indexes into this (by the backend's 1-based absolute row
  // number) rather than `attendees`, since `attendees` no longer resembles
  // the source file once columns have been renamed/dropped.
  dedupedRows: Record<string, string>[];
  // Fix 4 (CodeRabbit, PR #65): parallel to `attendees`/`dedupedRows` —
  // `originalRowIndices[i]` is that row's 1-based position in the operator's
  // ORIGINAL source file, threaded straight from `dedupeByEmail`. Consumers
  // translate a post-dedup position (what `mapChunkRowToAbsolute` computes)
  // into the file row an operator would actually recognize, and build the
  // reverse lookup (original row -> post-dedup index) needed to index back
  // into `attendees`/`dedupedRows` for retry/download.
  originalRowIndices: number[];
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
  const { deduped, mergedCount, originalIndices } = dedupeByEmail(rows, emailHeader);

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

  return {
    attendees,
    field_schema: fieldSchema,
    mergedDuplicates: mergedCount,
    dedupedRows: deduped,
    originalRowIndices: originalIndices,
  };
}

// Task 13 — chunked import submission.

// Board 3c / the task brief's exact chunk size: each bulk-import POST
// carries at most this many rows.
export const IMPORT_CHUNK_SIZE = 500;

// Pure array chunker — no chunk is ever empty, and an input whose length is
// an exact multiple of `size` produces no trailing empty chunk (a plain
// `Array.from({length: Math.ceil(n/size)})` loop, not a slice-until-empty
// loop, would get this subtly wrong for exact multiples).
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Maps a chunk-relative, 1-based row number (as returned by
// BulkImportResponse.errors[].row, which is "1-based index into the
// submitted attendees array" — i.e. into that ONE chunk's request body) back
// to the row's 1-based position in the full post-dedup attendee list.
// chunkIndex is 0-based. Written and unit-tested as a standalone pure
// function per the task brief, rather than inlined at the call site, since
// an off-by-one here would silently mislabel which source row an error
// belongs to.
export function mapChunkRowToAbsolute(chunkIndex: number, chunkSize: number, chunkRelativeRow: number): number {
  return chunkIndex * chunkSize + chunkRelativeRow;
}

// Builds a CSV of arbitrary header-keyed rows (the wizard's raw parsed CSV
// row shape), reusing exportCsv.ts's BOM + sanitizeCsvField escaping (same
// formula-injection guard, same quoting rules) rather than reimplementing
// CSV escaping a second time in this codebase. Distinct from
// exportCsv.ts's buildAttendeesCsv, which is hard-coded to the Attendee
// schema's fixed column set — this one takes an arbitrary header list
// because the wizard's source CSV can have any columns.
export function buildFailedRowsCsv(headers: string[], rows: Record<string, string>[]): string {
  const headerRow = headers.map(sanitizeCsvField).join(",");
  const dataRows = rows.map((row) => headers.map((header) => sanitizeCsvField(row[header] ?? "")).join(","));
  return BOM + [headerRow, ...dataRows].join("\r\n");
}
