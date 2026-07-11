import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImpersonationBanner } from '../ImpersonationBanner';
import '../../i18n';

vi.mock('axios', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { logs: [{ created_at: new Date().toISOString() }] } }) },
}));

describe('ImpersonationBanner exit summary', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('operator_token', 'operator-token-abc');
    localStorage.setItem(
      'impersonation',
      JSON.stringify({
        tenantId: 't1',
        tenantName: 'Acme Corp',
        expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
        mintedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      })
    );
  });

  it('shows a fetched summary before the operator confirms exit', async () => {
    render(<ImpersonationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /exit session/i }));
    await waitFor(() => expect(screen.getByText(/made 1 changes/i)).toBeInTheDocument());
  });
});
