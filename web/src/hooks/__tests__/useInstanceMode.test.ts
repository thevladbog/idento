import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

describe('useInstanceMode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(api.get).mockReset();
  });

  it('starts as onprem/loading before the fetch resolves', async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    const { useInstanceMode } = await import('../useInstanceMode');

    const { result } = renderHook(() => useInstanceMode());

    expect(result.current).toEqual({ mode: 'onprem', loading: true });
  });

  it('resolves to saas when the backend reports saas', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mode: 'saas', version: '1.0.0', license: null } });
    const { useInstanceMode } = await import('../useInstanceMode');

    const { result } = renderHook(() => useInstanceMode());

    await waitFor(() => expect(result.current).toEqual({ mode: 'saas', loading: false }));
  });

  it('resolves to onprem when the backend reports onprem', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mode: 'onprem', version: '1.0.0', license: null } });
    const { useInstanceMode } = await import('../useInstanceMode');

    const { result } = renderHook(() => useInstanceMode());

    await waitFor(() => expect(result.current).toEqual({ mode: 'onprem', loading: false }));
  });
});
