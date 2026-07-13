import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollSpy } from '../useScrollSpy';

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe('useScrollSpy', () => {
  let observerInstance: MockIntersectionObserver;

  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <div id="summary"></div>
        <div id="lifecycle"></div>
      </main>
    `;
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(function (cb: IntersectionObserverCallback) {
        observerInstance = new MockIntersectionObserver(cb);
        return observerInstance;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the first section id', () => {
    const { result } = renderHook(() => useScrollSpy(['summary', 'lifecycle']));
    expect(result.current).toBe('summary');
  });

  it('updates to the section reported as intersecting', () => {
    const { result } = renderHook(() => useScrollSpy(['summary', 'lifecycle']));
    const lifecycleEl = document.getElementById('lifecycle')!;
    act(() => {
      observerInstance.callback(
        [{ isIntersecting: true, target: lifecycleEl } as unknown as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver
      );
    });
    expect(result.current).toBe('lifecycle');
  });
});

describe('useScrollSpy - sections mounted after an async loading gate', () => {
  let observerInstance: MockIntersectionObserver;
  let rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    // Mirrors OrganizationDetail.tsx: the hook mounts while the page is
    // still showing a loading skeleton, before the section elements exist.
    document.body.innerHTML = `<main></main>`;
    rafCallback = null;

    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(function (cb: IntersectionObserverCallback) {
        observerInstance = new MockIntersectionObserver(cb);
        return observerInstance;
      })
    );
    // Capture the rAF callback instead of invoking it immediately, so the
    // test controls exactly when the retry fires (no real timing waits,
    // and no risk of an unbounded synchronous retry loop).
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 1;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the observer once sections appear post-mount and reflects intersection', () => {
    const { result } = renderHook(() => useScrollSpy(['summary', 'lifecycle']));

    // No elements exist yet, so the hook must not have set up an observer
    // and must have scheduled a retry instead of giving up silently.
    expect(result.current).toBe('summary');
    expect(rafCallback).not.toBeNull();

    // Simulate the loading gate resolving and the real sections mounting.
    const main = document.querySelector('main')!;
    main.innerHTML = `
      <div id="summary"></div>
      <div id="lifecycle"></div>
    `;

    // Flush the pending retry — this is when the observer actually attaches.
    act(() => {
      rafCallback!(0);
    });

    const lifecycleEl = document.getElementById('lifecycle')!;
    act(() => {
      observerInstance.callback(
        [{ isIntersecting: true, target: lifecycleEl } as unknown as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver
      );
    });

    expect(result.current).toBe('lifecycle');
  });
});
