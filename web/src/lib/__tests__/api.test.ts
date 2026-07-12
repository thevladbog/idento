import { describe, it, expect, afterEach, vi } from 'vitest';

describe('api baseURL resolution', () => {
  const originalEnv = window.__ENV__;

  afterEach(() => {
    window.__ENV__ = originalEnv;
    vi.resetModules();
  });

  it('uses window.__ENV__.API_URL when set', async () => {
    window.__ENV__ = { API_URL: 'https://runtime.example.com' };
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('https://runtime.example.com');
  });

  it('falls back to the hardcoded default when window.__ENV__.API_URL is empty and no Vite env var is set', async () => {
    window.__ENV__ = { API_URL: '' };
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('http://localhost:8008');
  });

  it('falls back to the hardcoded default when window.__ENV__ is undefined', async () => {
    window.__ENV__ = undefined;
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('http://localhost:8008');
  });

  it('exports getApiBaseUrl for callers that cannot use the shared api client (fonts.ts, impersonationSummary.ts)', async () => {
    window.__ENV__ = { API_URL: 'https://runtime.example.com' };
    const { getApiBaseUrl } = await import('../api');
    expect(getApiBaseUrl()).toBe('https://runtime.example.com');
  });
});
