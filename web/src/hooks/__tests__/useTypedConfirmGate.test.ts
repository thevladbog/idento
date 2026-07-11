import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypedConfirmGate } from '../useTypedConfirmGate';

describe('useTypedConfirmGate', () => {
  it('is unlocked when confirmText is undefined (no typed-confirm required)', () => {
    const { result } = renderHook(() => useTypedConfirmGate(true, undefined));
    expect(result.current.locked).toBe(false);
    expect(result.current.requireText).toBe(false);
  });

  it('locks when confirmText is an empty string (fail closed, does not bypass)', () => {
    const { result } = renderHook(() => useTypedConfirmGate(true, ''));
    expect(result.current.locked).toBe(true);
  });

  it('unlocks only once typed matches confirmText exactly', () => {
    const { result } = renderHook(() => useTypedConfirmGate(true, 'Acme Corp'));
    expect(result.current.locked).toBe(true);
    act(() => result.current.setTyped('Acme Cor'));
    expect(result.current.locked).toBe(true);
    act(() => result.current.setTyped('Acme Corp'));
    expect(result.current.locked).toBe(false);
  });

  it('resets typed text when open transitions to true', () => {
    const { result, rerender } = renderHook(({ open }) => useTypedConfirmGate(open, 'X'), {
      initialProps: { open: false },
    });
    act(() => result.current.setTyped('X'));
    rerender({ open: true });
    expect(result.current.typed).toBe('');
  });
});
