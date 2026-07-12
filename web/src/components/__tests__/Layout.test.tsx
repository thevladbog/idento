import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../Layout';
import '../../i18n';

vi.mock('@/lib/instance', () => ({
  getInstanceInfo: vi.fn(),
}));

function renderLayout() {
  return render(
    <MemoryRouter>
      <Layout>
        <div>content</div>
      </Layout>
    </MemoryRouter>
  );
}

describe('Layout Super Admin nav item mode awareness', () => {
  beforeEach(() => {
    // Mock window.matchMedia (needed by ModeToggle component)
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
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ email: 'admin@test.local', is_super_admin: true }));
  });

  it('shows the Super Admin link when is_super_admin is true and mode is saas', async () => {
    const { getInstanceInfo } = await import('@/lib/instance');
    vi.mocked(getInstanceInfo).mockResolvedValue({ mode: 'saas', version: '1.0.0', license: null });
    renderLayout();

    await waitFor(() => expect(screen.getByRole('link', { name: /super admin/i })).toBeInTheDocument());
  });

  it('hides the Super Admin link when is_super_admin is true but mode is onprem', async () => {
    const { getInstanceInfo } = await import('@/lib/instance');
    vi.mocked(getInstanceInfo).mockResolvedValue({ mode: 'onprem', version: '1.0.0', license: null });
    renderLayout();

    // The hook's pre-resolution default is ALSO 'onprem', so a naive
    // waitFor on this negative assertion would trivially pass before the
    // mocked promise even resolves — proving nothing. Explicitly await the
    // same mocked call inside act() to flush the resulting state update first,
    // so this assertion genuinely reflects post-resolution state.
    await act(async () => {
      await getInstanceInfo();
    });

    expect(screen.queryByRole('link', { name: /super admin/i })).not.toBeInTheDocument();
  });

  it('hides the Super Admin link when mode is saas but is_super_admin is false', async () => {
    const { getInstanceInfo } = await import('@/lib/instance');
    localStorage.setItem('user', JSON.stringify({ email: 'user@test.local', is_super_admin: false }));
    vi.mocked(getInstanceInfo).mockResolvedValue({ mode: 'saas', version: '1.0.0', license: null });
    renderLayout();

    await act(async () => {
      await getInstanceInfo();
    });

    expect(screen.queryByRole('link', { name: /super admin/i })).not.toBeInTheDocument();
  });
});
