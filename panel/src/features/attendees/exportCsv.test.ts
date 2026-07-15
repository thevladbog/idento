import { buildAttendeesCsv, exportAttendeesCsv } from "./exportCsv";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

// jsdom's Blob implementation (this project's Vitest `environment: "jsdom"`)
// does not implement `.text()`/`.arrayBuffer()` (verified directly: both
// are `undefined` on a jsdom Blob instance's prototype) — only
// `FileReader.readAsArrayBuffer` reliably reads the raw bytes back out.
// Decoding with `TextDecoder(..., { ignoreBOM: true })` is required too:
// the default UTF-8 decode path strips a leading BOM (standard, spec'd
// behavior — verified separately that plain `readAsText` silently drops
// it), which would make the "starts with the BOM" assertion pass
// vacuously. `ignoreBOM: true` keeps the literal U+FEFF character in the
// decoded string so the test actually exercises what got downloaded.
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer);
      resolve(text);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: "a1",
    event_id: "evt-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    position: "Engineer",
    code: "PD-0107",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildAttendeesCsv", () => {
  it("prefixes the content with a UTF-8 BOM so Excel opens Cyrillic text correctly", () => {
    const csv = buildAttendeesCsv([makeAttendee()]);
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("builds the header row with the fixed base columns", () => {
    const csv = buildAttendeesCsv([makeAttendee()]);
    const [header] = csv.slice(1).split("\r\n");
    expect(header).toBe("First name,Last name,Email,Company,Position,Code,Checked in");
  });

  it("renders checked_in as yes/no from checkin_status", () => {
    const csv = buildAttendeesCsv([
      makeAttendee({ id: "a1", checkin_status: true }),
      makeAttendee({ id: "a2", checkin_status: false }),
    ]);
    const rows = csv.slice(1).split("\r\n").slice(1);
    expect(rows[0]?.endsWith(",yes")).toBe(true);
    expect(rows[1]?.endsWith(",no")).toBe(true);
  });

  it("appends the union of custom-field keys across all selected rows as extra columns", () => {
    const csv = buildAttendeesCsv([
      makeAttendee({ id: "a1", custom_fields: { dietary: "vegan" } }),
      makeAttendee({ id: "a2", custom_fields: { shirt_size: "L" } }),
    ]);
    const [header, row1, row2] = csv.slice(1).split("\r\n");
    expect(header).toBe("First name,Last name,Email,Company,Position,Code,Checked in,dietary,shirt_size");
    // a1 has dietary but not shirt_size -> shirt_size column empty for a1
    expect(row1).toBe("Ada,Lovelace,ada@example.com,Analytical Engines,Engineer,PD-0107,no,vegan,");
    expect(row2).toBe("Ada,Lovelace,ada@example.com,Analytical Engines,Engineer,PD-0107,no,,L");
  });

  it("quotes fields containing commas and doubles up internal quotes", () => {
    const csv = buildAttendeesCsv([makeAttendee({ company: 'Acme, Inc. "Rockets"' })]);
    const [, row] = csv.slice(1).split("\r\n");
    expect(row).toContain('"Acme, Inc. ""Rockets"""');
  });

  it("quotes fields containing embedded newlines", () => {
    const csv = buildAttendeesCsv([makeAttendee({ position: "Line1\nLine2" })]);
    const [, row] = csv.slice(1).split("\r\n");
    expect(row).toContain('"Line1\nLine2"');
  });

  it("prefixes formula-injection trigger characters with a leading apostrophe before quoting", () => {
    const csv = buildAttendeesCsv([
      makeAttendee({ id: "a1", custom_fields: { note: "=SUM(A1:A2)" } }),
    ]);
    const [, row] = csv.slice(1).split("\r\n");
    // "=SUM(A1:A2)" has no comma/quote/newline, so it stays unquoted but
    // gets the apostrophe prefix — Excel then renders it as inert text.
    expect(row?.endsWith(",'=SUM(A1:A2)")).toBe(true);
  });

  it("prefixes every other formula-injection trigger character (+, -, @, tab, CR)", () => {
    const csv = buildAttendeesCsv([
      makeAttendee({ id: "a1", custom_fields: { note: "+1" } }),
      makeAttendee({ id: "a2", custom_fields: { note: "-1" } }),
      makeAttendee({ id: "a3", custom_fields: { note: "@cmd" } }),
      makeAttendee({ id: "a4", custom_fields: { note: "\tstart" } }),
      makeAttendee({ id: "a5", custom_fields: { note: "\rstart" } }),
    ]);
    const rows = csv.slice(1).split("\r\n").slice(1);
    expect(rows[0]?.endsWith(",'+1")).toBe(true);
    expect(rows[1]?.endsWith(",'-1")).toBe(true);
    expect(rows[2]?.endsWith(",'@cmd")).toBe(true);
    expect(rows[3]).toContain(",'\tstart");
    // "\r" is also in the standard-CSV-quoting trigger set (it's a
    // line-ending character), so the prefixed value additionally gets
    // wrapped in quotes, unlike the other trigger characters above.
    expect(rows[4]).toContain(',"\'\rstart"');
  });

  it("does not prefix a value that merely contains a formula-trigger character mid-string", () => {
    const csv = buildAttendeesCsv([
      makeAttendee({ id: "a1", custom_fields: { note: "a=b+c" } }),
    ]);
    const [, row] = csv.slice(1).split("\r\n");
    expect(row?.endsWith(",a=b+c")).toBe(true);
  });

  it("treats a missing custom field as an empty string for that row rather than fabricating one", () => {
    const csv = buildAttendeesCsv([
      makeAttendee({ id: "a1", custom_fields: { dietary: "vegan" } }),
      makeAttendee({ id: "a2" }),
    ]);
    const [, , row2] = csv.slice(1).split("\r\n");
    expect(row2).toBe("Ada,Lovelace,ada@example.com,Analytical Engines,Engineer,PD-0107,no,");
  });
});

describe("exportAttendeesCsv", () => {
  it("triggers a Blob download via URL.createObjectURL + a temporary anchor click (no navigation, no window.open)", () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    exportAttendeesCsv([makeAttendee()]);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
    expect(windowOpenSpy).not.toHaveBeenCalled();

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
    windowOpenSpy.mockRestore();
  });

  it("the downloaded Blob's decoded text starts with the BOM and matches buildAttendeesCsv's output", async () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const rows = [makeAttendee({ custom_fields: { note: "=1+1" } })];
    exportAttendeesCsv(rows);

    const blobArg = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    const text = await readBlobAsText(blobArg);
    expect(text).toBe(buildAttendeesCsv(rows));
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain("'=1+1");

    vi.restoreAllMocks();
  });
});
