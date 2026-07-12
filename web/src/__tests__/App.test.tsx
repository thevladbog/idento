import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import api from '@/lib/api';
import '../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

// App.tsx owns its own BrowserRouter, so drive navigation via history.pushState
// before importing/rendering App, matching how the router will read location
// on mount.
function renderAppAt(path: string) {
  window.history.pushState({}, '', path);
  return import('../App').then(({ default: App }) => render(<App />));
}

describe('App /register route mode gating', () => {
  beforeEach(() => {
    // Login.tsx and Register.tsx both render ModeToggle, which calls
    // window.matchMedia in a useEffect on mount; jsdom doesn't implement it,
    // so without a mock any full-page render (as opposed to just the guard
    // in isolation) throws. Same mock as Login.test.tsx (Task 2).
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.resetModules();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('renders the Register page when mode is saas', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mode: 'saas', version: '1.0.0', license: null } });
    await renderAppAt('/register');

    // Register.tsx's CardTitle renders as a plain <div> (no heading role), and
    // "Create Account" is used both as the title AND the submit button's
    // non-submitting label — so assert on the submit button specifically
    // (Button IS a real <button>, and its label is the i18n `register` key,
    // "Register", distinct from `registerButton`'s "Create Account").
    await waitFor(() => expect(screen.getByRole('button', { name: /^register$/i })).toBeInTheDocument());
  });

  it('redirects to /login when mode is onprem', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mode: 'onprem', version: '1.0.0', license: null } });
    await renderAppAt('/register');

    // Login.tsx's submit button label is the i18n `loginButton` key, "Sign
    // In" — unique on the page, unlike CardTitle's "Login" (also not a real
    // heading element).
    await waitFor(() => expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument();
  });

  it('redirects to /login when GET /api/instance fails (safe-default fallback)', async () => {
    // getInstanceInfo()'s own .catch() resolves failures to the 'onprem'
    // safe default rather than rejecting — this exercises that fallback
    // through the full SaasOnlyRoute redirect chain, not just the isolated
    // lib/hook unit tests.
    vi.mocked(api.get).mockRejectedValue(new Error('network error'));
    await renderAppAt('/register');

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument();
  });
});
