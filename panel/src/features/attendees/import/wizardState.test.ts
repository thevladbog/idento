import {
  buildBulkPayload, computeDefaultMapping, createInitialWizardState, dedupeByEmail, type MappingTarget,
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
});
