import { describe, it, expect, afterEach, vi } from 'vitest';

describe('api baseURL resolution', () => {
  const originalEnv = window.__ENV__;

  afterEach(() => {
    window.__ENV__ = originalEnv;
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('uses window.__ENV__.API_URL when set', async () => {
    window.__ENV__ = { API_URL: 'https://runtime.example.com' };
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('https://runtime.example.com');
  });

  it('falls back to VITE_API_URL when window.__ENV__.API_URL is not set', async () => {
    window.__ENV__ = {};
    vi.stubEnv('VITE_API_URL', 'https://vite.example.com');
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('https://vite.example.com');
  });

  it('falls back to the hardcoded default when window.__ENV__.API_URL is empty and no Vite env var is set', async () => {
    window.__ENV__ = { API_URL: '' };
    vi.stubEnv('VITE_API_URL', '');
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('http://localhost:8008');
  });

  it('falls back to the hardcoded default when window.__ENV__ is undefined', async () => {
    window.__ENV__ = undefined;
    vi.stubEnv('VITE_API_URL', '');
    const { default: api } = await import('../api');
    expect(api.defaults.baseURL).toBe('http://localhost:8008');
  });

  it('exports getApiBaseUrl for callers that cannot use the shared api client (fonts.ts, impersonationSummary.ts)', async () => {
    window.__ENV__ = { API_URL: 'https://runtime.example.com' };
    const { getApiBaseUrl } = await import('../api');
    expect(getApiBaseUrl()).toBe('https://runtime.example.com');
  });
});

// The console is served under Vite's base (/super-admin/). A raw '/login'
// redirect both escapes the SPA in dev (Vite refuses paths outside the
// base) and lands on the TENANT PANEL's login in the combined production
// image -- and the old already-on-login guard compared against base-less
// paths, so it never matched at all. Same base-awareness lesson as PR
// #94's asset URLs.
describe('401 interceptor base-aware redirect', () => {
  const realLocation = window.location;

  function mockLocation(pathname: string): { href: string } {
    const captured = { href: '' };
    // @ts-expect-error -- intentionally deleting a non-optional global for the mock swap
    delete window.location;
    window.location = {
      ...realLocation,
      pathname,
      set href(v: string) {
        captured.href = v;
      },
      get href() {
        return captured.href;
      },
    } as unknown as Location;
    return captured;
  }

  afterEach(() => {
    window.location = realLocation;
    localStorage.clear();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function fire401(pathname: string): Promise<{ href: string }> {
    vi.stubEnv('BASE_URL', '/super-admin/');
    window.__ENV__ = { API_URL: 'http://api.test' };
    const captured = mockLocation(pathname);
    localStorage.setItem('token', 'stale');
    const { default: api } = await import('../api');
    const rejected = (
      api.interceptors.response as unknown as {
        handlers: Array<{ rejected: (e: unknown) => Promise<never> }>;
      }
    ).handlers[0].rejected;
    await expect(rejected({ response: { status: 401 } })).rejects.toBeTruthy();
    return captured;
  }

  it('redirects to the base-aware login page, never a raw /login', async () => {
    const captured = await fire401('/super-admin/organizations');
    expect(captured.href).toBe('/super-admin/login');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('does not redirect when already on the base-aware login page (the old guard compared base-less paths and never matched)', async () => {
    const captured = await fire401('/super-admin/login');
    expect(captured.href).toBe('');
    expect(localStorage.getItem('token')).toBeNull();
  });
});
