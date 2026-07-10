import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Organizations from '../Organizations';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockTenants = [
  {
    tenant: { id: '1', name: 'Acme Conf Group', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    subscription: { status: 'active', plan: { name: 'Professional', slug: 'pro', limits: { attendees_per_event: 500 } } },
    users_count: 4,
    events_count: 2,
    attendees_count: 600,
    last_activity: '2026-07-01T00:00:00Z',
  },
  {
    tenant: { id: '2', name: 'Forum One', status: 'suspended', created_at: '2026-02-01T00:00:00Z' },
    subscription: { status: 'trial', plan: { name: 'Starter', slug: 'starter', limits: { attendees_per_event: 100 } } },
    users_count: 1,
    events_count: 1,
    attendees_count: 50,
    last_activity: null,
  },
];

describe('Organizations (Tenants list)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: mockTenants });
  });

  it('renders an OVER LIMIT badge only for the tenant that exceeds its plan limit', async () => {
    render(
      <MemoryRouter>
        <Organizations />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Acme Conf Group')).toBeInTheDocument());
    const rows = screen.getAllByRole('row');
    const acmeRow = rows.find((r) => r.textContent?.includes('Acme Conf Group'));
    const forumRow = rows.find((r) => r.textContent?.includes('Forum One'));
    expect(acmeRow?.textContent).toContain('OVER LIMIT');
    expect(forumRow?.textContent).not.toContain('OVER LIMIT');
  });

  it('renders the saved-queue chip counts', async () => {
    render(
      <MemoryRouter>
        <Organizations />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByText((_, el) => el?.textContent === 'All · 2')).toBeInTheDocument()
    );
    expect(screen.getByText((_, el) => el?.textContent === 'Over limit · 1')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === 'Suspended · 1')).toBeInTheDocument();
  });
});
