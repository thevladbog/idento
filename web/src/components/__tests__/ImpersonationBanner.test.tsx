import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImpersonationBanner } from '../ImpersonationBanner';
import '../../i18n';

const axiosGetMock = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => axiosGetMock(...args) },
}));

const OPERATOR_ID = 'operator-1';

describe('ImpersonationBanner exit summary', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('operator_token', 'operator-token-abc');
    localStorage.setItem('user', JSON.stringify({ id: OPERATOR_ID, email: 'operator@test.local' }));
    localStorage.setItem(
      'impersonation',
      JSON.stringify({
        tenantId: 't1',
        tenantName: 'Acme Corp',
        expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
        mintedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      })
    );
    axiosGetMock.mockReset();
  });

  it('shows a fetched summary before the operator confirms exit', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        total: 1,
        logs: [{ created_at: new Date().toISOString(), admin_user_id: OPERATOR_ID }],
      },
    });
    render(<ImpersonationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /exit session/i }));
    await waitFor(() => expect(screen.getByText(/made 1 changes/i)).toBeInTheDocument());
  });

  it('does not count another operator\'s overlapping impersonated_request rows', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        total: 2,
        logs: [
          { created_at: new Date().toISOString(), admin_user_id: 'other-operator' },
          { created_at: new Date().toISOString(), admin_user_id: OPERATOR_ID },
        ],
      },
    });
    render(<ImpersonationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /exit session/i }));
    await waitFor(() => expect(screen.getByText(/made 1 changes/i)).toBeInTheDocument());
  });

  it('clears the stale summary from a previous exit attempt before showing a fresh one', async () => {
    let call = 0;
    axiosGetMock.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          data: { total: 3, logs: Array.from({ length: 3 }, () => ({ created_at: new Date().toISOString(), admin_user_id: OPERATOR_ID })) },
        });
      }
      return new Promise(() => {}); // second attempt never resolves during the assertion window
    });
    render(<ImpersonationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /exit session/i }));
    await waitFor(() => expect(screen.getByText(/made 3 changes/i)).toBeInTheDocument());

    // dismiss without confirming exit (Escape closes the Radix dialog without navigating away)
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/made 3 changes/i)).not.toBeInTheDocument());

    // reopen: the stale "3 changes" must not flash back while the new (never-resolving) fetch is in flight
    fireEvent.click(screen.getByRole('button', { name: /exit session/i }));
    expect(screen.queryByText(/made 3 changes/i)).not.toBeInTheDocument();
  });
});
