// P4.3 Task 8 -- the printer wizard's Test step physical-verification label
// (board 5b). Deliberately NOT rasterized/previewed client-side (unlike
// badge ZPL generation, generateZpl.ts) -- this is a fixed, hand-authored
// ZPL payload with no attendee data or custom fonts involved, so there is
// nothing to generate from a doc.

/**
 * Builds the printer wizard's Test step label: alignment boxes in all four
 * corners (so the operator can judge position/darkness at a glance) plus a
 * Latin line and a `^CI28` (UTF-8) Cyrillic line -- «Кириллица 123»
 * printing correctly on the physical label IS the encoding-truth check
 * (board 5b's whole point of this step, task-8-brief.md).
 */
export function buildTestLabelZpl(printerName: string): string {
  // Printer name is operator-controlled local data going to their own
  // printer -- no injection surface -- but `^`/`~` are ZPL's own command
  // delimiters, so strip them defensively rather than let a stray
  // character corrupt this field's own data.
  const safeName = printerName.replace(/[\^~]/g, "");
  return [
    "^XA", "^CI28",
    "^FO20,20^GB80,80,4^FS", "^FO700,20^GB80,80,4^FS",
    "^FO20,380^GB80,80,4^FS", "^FO700,380^GB80,80,4^FS",
    "^FO140,120^A0N,60,60^FDIdento test^FS",
    "^FO140,200^A0N,50,50^FDКириллица 123^FS",
    `^FO140,280^A0N,30,30^FD${safeName}^FS`,
    "^XZ",
  ].join("");
}
