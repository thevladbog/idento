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
export function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? "");

  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let rafId: number | null = null;

    function trySetup() {
      const elements = sectionIds
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);

      if (elements.length === 0) {
        // Sections may not be in the DOM yet (e.g. still behind an async
        // loading gate in the caller). Keep polling via rAF until they
        // appear, rather than giving up after the first mount pass.
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
