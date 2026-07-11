import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../Login';
import '../../i18n';

vi.mock('@/lib/instance', () => ({
  getInstanceInfo: vi.fn(),
}));

beforeEach(() => {
  // Mock window.matchMedia for ModeToggle component
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
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
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage mode awareness', () => {
  it('shows the Register link when mode is saas', async () => {
    const { getInstanceInfo } = await import('@/lib/instance');
    vi.mocked(getInstanceInfo).mockResolvedValue({ mode: 'saas', version: '1.0.0', license: null });
    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: /register/i })).toBeInTheDocument());
  });

  it('hides the Register link when mode is onprem', async () => {
    const { getInstanceInfo } = await import('@/lib/instance');
    vi.mocked(getInstanceInfo).mockResolvedValue({ mode: 'onprem', version: '1.0.0', license: null });
    renderPage();

    await waitFor(() => expect(screen.queryByRole('link', { name: /register/i })).not.toBeInTheDocument());
  });

  it('the QR Login link is unaffected by mode', async () => {
    const { getInstanceInfo } = await import('@/lib/instance');
    vi.mocked(getInstanceInfo).mockResolvedValue({ mode: 'onprem', version: '1.0.0', license: null });
    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: /qr login/i })).toBeInTheDocument());
  });
});
