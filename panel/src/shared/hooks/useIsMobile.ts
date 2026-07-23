import * as React from "react";

// Tailwind's `md` breakpoint is 768px; .98 keeps the query strictly below it
// so CSS (`md:*`) and JS agree on which side a 768px-wide viewport is on.
const MOBILE_QUERY = "(max-width: 767.98px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

// The ONE sanctioned JS viewport check (panel/AGENTS.md "Adaptive layout").
// Prefer Tailwind responsive classes; reach for this only at a component
// swap point where CSS cannot express the difference (a gate, a table↔list
// swap) — never in leaf components.
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
