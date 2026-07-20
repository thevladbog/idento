// P4.3 Task 8 -- the printer wizard's physical-verification test label
// (board 5b). The Cyrillic sample is the point of the test, not incidental
// copy (task-8-brief.md): «Кириллица 123» printing correctly on the
// physical label IS the encoding-truth check, so `^CI28` (ZPL's UTF-8 code
// page) and the literal Cyrillic text are pinned here as load-bearing
// assertions, not just "does it look like ZPL".
import { buildTestLabelZpl } from "./testLabel";

describe("buildTestLabelZpl", () => {
  it("starts with ^XA and ends with ^XZ", () => {
    const zpl = buildTestLabelZpl("Zebra_ZD421");
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
  });

  it("declares ^CI28 (UTF-8) so the Cyrillic sample renders correctly", () => {
    expect(buildTestLabelZpl("Zebra_ZD421")).toContain("^CI28");
  });

  it("includes the «Кириллица 123» encoding-truth sample", () => {
    expect(buildTestLabelZpl("Zebra_ZD421")).toContain("Кириллица 123");
  });

  it("includes the printer name", () => {
    expect(buildTestLabelZpl("Zebra_ZD421")).toContain("Zebra_ZD421");
  });

  it("draws alignment boxes (^GB) in the four corners", () => {
    const zpl = buildTestLabelZpl("Zebra_ZD421");
    expect(zpl.match(/\^GB/g)).toHaveLength(4);
  });

  // Printer name is operator-controlled local data (their own device's
  // name) going to their own printer -- no injection surface across a
  // trust boundary -- but `^`/`~` are ZPL's own command delimiters, so a
  // name containing them would corrupt the label's own field data. Strip
  // defensively rather than trust every possible agent-reported name.
  it("strips ^ and ~ from the printer name defensively", () => {
    const zpl = buildTestLabelZpl("Weird^Name~Here");
    expect(zpl).toContain("WeirdNameHere");
    expect(zpl).not.toContain("Weird^Name");
    expect(zpl).not.toContain("Name~Here");
  });
});
