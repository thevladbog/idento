import {
  buildBulkPayload, buildFailedRowsCsv, chunkArray, computeDefaultMapping, createInitialWizardState,
  dedupeByEmail, IMPORT_CHUNK_SIZE, mapChunkRowToAbsolute, type MappingTarget,
} from "./wizardState";

describe("createInitialWizardState", () => {
  it("starts at step 1 with no file, utf-8 default, not overridden, and empty rows/headers/mapping", () => {
    expect(createInitialWizardState()).toEqual({
      step: 1,
      encoding: "utf-8",
      encodingOverridden: false,
      rows: [],
      headers: [],
      mapping: {},
    });
  });

  it("returns a fresh object each call (no shared mutable state across wizard instances)", () => {
    const a = createInitialWizardState();
    const b = createInitialWizardState();
    expect(a).not.toBe(b);
    expect(a.rows).not.toBe(b.rows);
    expect(a.mapping).not.toBe(b.mapping);
  });
});

describe("computeDefaultMapping", () => {
  it("maps a ФИО-only header to first_name only, without fabricating a last_name split", () => {
    const mapping = computeDefaultMapping(["ФИО", "Компания", "Email", "Примечание"]);
    expect(mapping).toEqual({
      ФИО: { kind: "standard", field: "first_name" },
      Компания: { kind: "standard", field: "company" },
      Email: { kind: "standard", field: "email" },
      Примечание: { kind: "unset" },
    });
  });

  it("maps separate Имя/Фамилия headers to first_name/last_name respectively", () => {
    const mapping = computeDefaultMapping(["Имя", "Фамилия", "Email"]);
    expect(mapping).toEqual({
      Имя: { kind: "standard", field: "first_name" },
      Фамилия: { kind: "standard", field: "last_name" },
      Email: { kind: "standard", field: "email" },
    });
  });

  it("maps position/role and code headers case-insensitively", () => {
    const mapping = computeDefaultMapping(["Должность", "CODE", "Организация"]);
    expect(mapping).toEqual({
      Должность: { kind: "standard", field: "position" },
      CODE: { kind: "standard", field: "code" },
      Организация: { kind: "standard", field: "company" },
    });
  });

  it("does not let an English 'Last name' header get claimed by the first_name rule's broader 'name' substring", () => {
    const mapping = computeDefaultMapping(["Last name", "First name"]);
    expect(mapping).toEqual({
      "Last name": { kind: "standard", field: "last_name" },
      "First name": { kind: "standard", field: "first_name" },
    });
  });
});

describe("dedupeByEmail", () => {
  const rows = [
    { name: "Anna", email: "a@example.com" },
    { name: "Oleg", email: "O@Example.com" },
    { name: "Maria", email: "m@example.com" },
    { name: "Anna Dup", email: "a@example.com" },
  ];

  it("keeps the first occurrence of each case-insensitively-compared email and drops later duplicates", () => {
    const result = dedupeByEmail(rows, "email");
    expect(result.deduped).toEqual([
      { name: "Anna", email: "a@example.com" },
      { name: "Oleg", email: "O@Example.com" },
      { name: "Maria", email: "m@example.com" },
    ]);
  });

  it("returns the correct mergedCount of dropped duplicate rows", () => {
    const result = dedupeByEmail(rows, "email");
    expect(result.mergedCount).toBe(1);
  });

  it("passes rows through unchanged with mergedCount 0 when no column is mapped to email", () => {
    const result = dedupeByEmail(rows, undefined);
    expect(result.deduped).toEqual(rows);
    expect(result.mergedCount).toBe(0);
  });

  it("does not drop rows with a blank email value (only non-empty duplicates are merged)", () => {
    const rowsWithBlanks = [
      { name: "A", email: "" },
      { name: "B", email: "" },
      { name: "C", email: "c@example.com" },
    ];
    const result = dedupeByEmail(rowsWithBlanks, "email");
    expect(result.deduped).toEqual(rowsWithBlanks);
    expect(result.mergedCount).toBe(0);
  });
});

describe("buildBulkPayload", () => {
  it("maps standard-mapped columns to their standard keys", () => {
    const rows = [{ Имя: "Анна", Email: "a@example.com" }];
    const mapping: Record<string, MappingTarget> = {
      Имя: { kind: "standard", field: "first_name" },
      Email: { kind: "standard", field: "email" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.attendees).toEqual([{ first_name: "Анна", email: "a@example.com" }]);
  });

  it("maps custom-mapped columns under their custom field name as the key", () => {
    const rows = [{ Категория: "VIP" }];
    const mapping: Record<string, MappingTarget> = {
      Категория: { kind: "custom", name: "Категория" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.attendees).toEqual([{ Категория: "VIP" }]);
    expect(result.field_schema).toEqual(["Категория"]);
  });

  it("omits skip and unset columns entirely from each attendee row", () => {
    const rows = [{ Имя: "Анна", Примечание: "note", Прочее: "x" }];
    const mapping: Record<string, MappingTarget> = {
      Имя: { kind: "standard", field: "first_name" },
      Примечание: { kind: "skip" },
      Прочее: { kind: "unset" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.attendees).toEqual([{ first_name: "Анна" }]);
    expect(result.field_schema).toEqual(["first_name"]);
  });

  it("orders field_schema by the order the source columns first appear in the mapping (header order)", () => {
    const rows = [{ Компания: "Ромашка", Имя: "Анна", Email: "a@example.com" }];
    const mapping: Record<string, MappingTarget> = {
      Компания: { kind: "standard", field: "company" },
      Имя: { kind: "standard", field: "first_name" },
      Email: { kind: "standard", field: "email" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.field_schema).toEqual(["company", "first_name", "email"]);
  });

  it("applies in-file dedup by whichever column is mapped to email and reports mergedDuplicates", () => {
    const rows = [
      { Имя: "Анна", Email: "a@example.com" },
      { Имя: "Анна Dup", Email: "A@Example.com" },
      { Имя: "Олег", Email: "o@example.com" },
    ];
    const mapping: Record<string, MappingTarget> = {
      Имя: { kind: "standard", field: "first_name" },
      Email: { kind: "standard", field: "email" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.attendees).toEqual([
      { first_name: "Анна", email: "a@example.com" },
      { first_name: "Олег", email: "o@example.com" },
    ]);
    expect(result.mergedDuplicates).toBe(1);
  });

  it("reports mergedDuplicates 0 and includes all rows when no column is mapped to email", () => {
    const rows = [{ Имя: "Анна" }, { Имя: "Анна" }];
    const mapping: Record<string, MappingTarget> = {
      Имя: { kind: "standard", field: "first_name" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.attendees).toHaveLength(2);
    expect(result.mergedDuplicates).toBe(0);
  });

  // Task 13: `dedupedRows` is the raw (header-keyed, pre-transform) source
  // row for each surviving attendee, in the same order/length as
  // `attendees` — this is what step 3's "download failed rows as CSV" looks
  // up by absolute row number, since `attendees` has already been
  // transformed to field_schema keys and no longer looks like the original
  // file.
  it("returns dedupedRows as the raw source rows that survived in-file dedup, 1:1 with attendees", () => {
    const rows = [
      { Имя: "Анна", Email: "a@example.com" },
      { Имя: "Анна Dup", Email: "A@Example.com" },
      { Имя: "Олег", Email: "o@example.com" },
    ];
    const mapping: Record<string, MappingTarget> = {
      Имя: { kind: "standard", field: "first_name" },
      Email: { kind: "standard", field: "email" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.dedupedRows).toEqual([
      { Имя: "Анна", Email: "a@example.com" },
      { Имя: "Олег", Email: "o@example.com" },
    ]);
    expect(result.dedupedRows).toHaveLength(result.attendees.length);
  });

  it("returns dedupedRows unchanged (same as input rows) when no column is mapped to email", () => {
    const rows = [{ Имя: "Анна" }, { Имя: "Олег" }];
    const mapping: Record<string, MappingTarget> = {
      Имя: { kind: "standard", field: "first_name" },
    };
    const result = buildBulkPayload(rows, mapping);
    expect(result.dedupedRows).toEqual(rows);
  });
});

describe("IMPORT_CHUNK_SIZE", () => {
  it("is 500 rows per chunk, per the task brief", () => {
    expect(IMPORT_CHUNK_SIZE).toBe(500);
  });
});

describe("chunkArray", () => {
  it("splits an array into fixed-size chunks, with a shorter final chunk for the remainder", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(chunkArray(items, 5)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [10, 11],
    ]);
  });

  it("returns a single chunk when the array is shorter than the chunk size", () => {
    expect(chunkArray([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
  });

  it("returns an empty array of chunks for an empty input array", () => {
    expect(chunkArray([], 500)).toEqual([]);
  });

  it("returns exactly one full chunk (no trailing empty chunk) when length is an exact multiple of size", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(chunkArray(items, 5)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ]);
  });
});

describe("mapChunkRowToAbsolute", () => {
  // The brief's own worked example: an error at chunk-relative row 3 in
  // chunk index 2 (0-based), with 500-row chunks, maps to absolute row 1003.
  it("maps chunk-relative row 3 in chunk index 2 (500-row chunks) to absolute row 1003", () => {
    expect(mapChunkRowToAbsolute(2, 500, 3)).toBe(1003);
  });

  it("maps a row in the first chunk (index 0) to itself unchanged", () => {
    expect(mapChunkRowToAbsolute(0, 500, 1)).toBe(1);
    expect(mapChunkRowToAbsolute(0, 500, 500)).toBe(500);
  });

  it("maps the first row of the second chunk (index 1) to chunkSize + 1", () => {
    expect(mapChunkRowToAbsolute(1, 500, 1)).toBe(501);
  });

  it("maps the last row of the second chunk (index 1) to 2 * chunkSize", () => {
    expect(mapChunkRowToAbsolute(1, 500, 500)).toBe(1000);
  });

  it("works with a non-500 chunk size (e.g. test-sized chunks)", () => {
    expect(mapChunkRowToAbsolute(3, 10, 4)).toBe(34);
  });
});

describe("buildFailedRowsCsv", () => {
  it("prefixes the content with a UTF-8 BOM", () => {
    const csv = buildFailedRowsCsv(["Имя", "Email"], [{ Имя: "Анна", Email: "a@example.com" }]);
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("builds a header row from the given headers and one data row per source row", () => {
    const csv = buildFailedRowsCsv(
      ["Имя", "Email"],
      [
        { Имя: "Анна", Email: "a@example.com" },
        { Имя: "Олег", Email: "o@example.com" },
      ],
    );
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toEqual(["Имя,Email", "Анна,a@example.com", "Олег,o@example.com"]);
  });

  it("treats a missing value for a header as an empty cell, not a fabricated one", () => {
    const csv = buildFailedRowsCsv(["Имя", "Email"], [{ Имя: "Анна" }]);
    const [, row] = csv.slice(1).split("\r\n");
    expect(row).toBe("Анна,");
  });

  it("applies the same formula-injection/quoting escaping as exportCsv's sanitizeCsvField", () => {
    const csv = buildFailedRowsCsv(["Note"], [{ Note: "=SUM(A1:A2)" }]);
    const [, row] = csv.slice(1).split("\r\n");
    expect(row).toBe("'=SUM(A1:A2)");
  });
});
