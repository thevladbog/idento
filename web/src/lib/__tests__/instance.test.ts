import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

describe('getInstanceInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(api.get).mockReset();
  });

  it('returns the parsed response on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mode: 'saas', version: '1.2.3', license: null } });
    const { getInstanceInfo } = await import('../instance');

    const info = await getInstanceInfo();

    expect(info).toEqual({ mode: 'saas', version: '1.2.3', license: null });
  });

  it('falls back to onprem when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network error'));
    const { getInstanceInfo } = await import('../instance');

    const info = await getInstanceInfo();

    expect(info.mode).toBe('onprem');
  });

  it('memoizes: a second call does not issue a second request', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mode: 'saas', version: '1.2.3', license: null } });
    const { getInstanceInfo } = await import('../instance');

    await getInstanceInfo();
    await getInstanceInfo();

    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
