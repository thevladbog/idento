import { useEffect, useState } from 'react';

/**
 * Tracks which of the given section element IDs is currently most visible,
 * for driving an anchor rail's active-link highlight. Resolves its
 * IntersectionObserver root from the nearest scrolling <main> ancestor
 * (this app's page scroll container is <main class="overflow-auto">, not
 * window) rather than assuming viewport scrolling.
 */
export function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? '');

  useEffect(() => {
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const root = elements[0].closest('main');

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sectionIds is a stable literal array from the caller
  }, [sectionIds.join(',')]);

  return activeId;
}
