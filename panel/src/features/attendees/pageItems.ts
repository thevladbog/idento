// Pure numbered-pager algorithm: always show the first page, the last page,
// and current-1/current/current+1, collapsing any gap between those into a
// single "…" — no fancier "don't ellipsis away just one page" heuristic
// (e.g. MUI's usePagination), per the task brief's literal description of
// this function ("first, last, current±1, ellipsis gaps"). Unit-tested
// directly in pageItems.test.ts; AttendeePager (AttendeeTable.tsx) is the
// only caller.
// Below this many total pages, every page fits without needing to hide any
// of them behind an ellipsis at all (first + last + current±1 would already
// cover 5 of them, so a 5-or-fewer-page pager never actually saves space by
// collapsing anything).
const NO_ELLIPSIS_THRESHOLD = 5;

export function pageItems(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 0) return [];
  if (totalPages <= NO_ELLIPSIS_THRESHOLD) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages]);
  for (let p = current - 1; p <= current + 1; p += 1) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  let previous: number | undefined;
  for (const page of sorted) {
    if (previous !== undefined && page - previous > 1) {
      result.push("…");
    }
    result.push(page);
    previous = page;
  }
  return result;
}
