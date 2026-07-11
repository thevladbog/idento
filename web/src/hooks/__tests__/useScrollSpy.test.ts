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
      vi.fn((cb: IntersectionObserverCallback) => {
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
