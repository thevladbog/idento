import Papa, { type ParseError, type ParseResult } from "papaparse";

export interface ParseCsvOptions {
  /** If set, only that many rows are parsed (used for the wizard's live preview). */
  preview?: number;
  /**
   * Whether to parse on a Web Worker thread. Production code (the Task 11
   * import wizard) passes `true` to keep the page responsive on large
   * files. Tests must pass `false` — PapaParse's worker mode requires a
   * real browser Worker context that jsdom/Node don't provide.
   */
  worker?: boolean;
}

export interface ParseCsvResult {
  rows: Record<string, string>[];
  headers: string[];
  // Fix 3 (CodeRabbit, PR #65): PapaParse's own per-row diagnostics
  // (inconsistent column counts, quote-parsing failures, etc.) — previously
  // read off `results.errors` and then discarded, meaning a genuinely
  // malformed CSV could silently produce garbage `rows` with zero warning.
  // Always populated (empty for a well-formed CSV), never thrown — matching
  // the "resolve either way" contract described below.
  errors: ParseError[];
}

// Thin Promise wrapper around Papa.parse for string input. Note: PapaParse's
// typings expose an `error` callback only for File/Blob and remote-URL
// parsing (FileReader/XHR failures) — there is no error callback for plain
// string input, so a malformed row surfaces as an entry in
// `results.errors` inside `complete`, not as a rejection. We resolve with
// whatever PapaParse produces either way, matching its actual API surface
// rather than inventing an error path it doesn't have for this input type.
export function parseCsv(text: string, opts: ParseCsvOptions = {}): Promise<ParseCsvResult> {
  return new Promise((resolve) => {
    const complete = (results: ParseResult<Record<string, string>>) => {
      resolve({ rows: results.data, headers: results.meta.fields ?? [], errors: results.errors });
    };
    // Papa.parse's overloads discriminate on the literal type of `worker`
    // (`true` vs `false`), so a plain `boolean` option value has to be
    // branched into two calls rather than passed through directly.
    if (opts.worker) {
      Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        preview: opts.preview,
        worker: true,
        complete,
      });
    } else {
      Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        preview: opts.preview,
        worker: false,
        complete,
      });
    }
  });
}
