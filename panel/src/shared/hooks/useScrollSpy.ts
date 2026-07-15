import { useEffect, useState } from "react";

/**
 * Tracks which of the given section element IDs is currently most visible,
 * for driving an anchor rail's active-link highlight.
 *
 * Ported from web/src/hooks/useScrollSpy.ts. That app's page scroll
 * container is a styled `<main class="overflow-auto">`, so it resolved the
 * IntersectionObserver root via `elements[0].closest('main')`. The panel
 * app's `<main>` (see AppShell.tsx) carries no scroll-container styling —
 * the WINDOW scrolls instead — so this port passes `root: null`, the
 * IntersectionObserver default meaning "the browser viewport".
 */
// Bound on how many rAF retries `trySetup` will schedule while waiting for
// `sectionIds` to appear in the DOM. ~150 attempts at ~60fps is roughly
// 2.5s — comfortably longer than any real data-loading scenario in this
// codebase (sections appear promptly once a query resolves, or the caller
// renders a permanent error state instead). A full MutationObserver rewrite
// would handle unbounded/async DOM mutation, but that's not this call site's
// pattern (EventSettingsPage.tsx either resolves its query or shows an error
// page), so it's YAGNI here — a bounded retry counter is enough to cap the
// busy-loop if the caller stays stuck in a loading state indefinitely.
const MAX_SETUP_RETRIES = 150;

export function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? "");

  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let rafId: number | null = null;
    let retries = 0;

    function trySetup() {
      const elements = sectionIds
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);

      if (elements.length === 0) {
        // Sections may not be in the DOM yet (e.g. still behind an async
        // loading gate in the caller). Keep polling via rAF until they
        // appear, up to MAX_SETUP_RETRIES — past that, stop rescheduling and
        // leave activeId at its last value (typically sectionIds[0]) with no
        // observer attached; an acceptable degraded state since the caller
        // isn't rendering real content in that scenario anyway.
        retries += 1;
        if (retries >= MAX_SETUP_RETRIES) return;
        rafId = requestAnimationFrame(trySetup);
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting);
          if (visible.length > 0) {
            setActiveId(visible[0].target.id);
          }
        },
        { root: null, rootMargin: "-10% 0px -70% 0px", threshold: 0 },
      );

      elements.forEach((el) => observer!.observe(el));
    }

    trySetup();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sectionIds is a stable literal array from the caller
  }, [sectionIds.join(",")]);

  return activeId;
}
