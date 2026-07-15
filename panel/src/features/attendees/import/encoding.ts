// Pure, framework-free encoding detection + decoding for the CSV import
// wizard (Tasks 11-13). Excel on Windows commonly exports CSVs as
// windows-1251 (a.k.a. CP1251) when the OS locale is Russian, rather than
// UTF-8, so we can't just assume UTF-8 for uploaded files.

export type CsvEncoding = "utf-8" | "windows-1251";

const CYRILLIC_RE = /[А-яЁё]/g;

function countCyrillic(text: string): number {
  return (text.match(CYRILLIC_RE) ?? []).length;
}

// Strategy: try a strict (fatal) UTF-8 decode first — real windows-1251
// text very often contains byte sequences that are outright invalid UTF-8,
// so this alone catches most cases. When the fatal decode does NOT throw
// (the windows-1251 bytes happen to also be well-formed, if meaningless,
// UTF-8), fall back to a density heuristic: decode the same bytes both ways
// non-fatally and compare how much real Cyrillic text each produces. If
// windows-1251 yields Cyrillic letters that the "successful" UTF-8 decode
// does not, the UTF-8 decode was mojibake and windows-1251 is preferred.
export function detectEncoding(buf: ArrayBuffer): CsvEncoding {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return "windows-1251";
  }

  const utf8Text = new TextDecoder("utf-8").decode(buf);
  const win1251Text = new TextDecoder("windows-1251").decode(buf);
  if (countCyrillic(win1251Text) > 0 && countCyrillic(utf8Text) === 0) {
    return "windows-1251";
  }

  return "utf-8";
}

export function decodeBuffer(buf: ArrayBuffer, enc: CsvEncoding): string {
  return new TextDecoder(enc).decode(buf);
}
