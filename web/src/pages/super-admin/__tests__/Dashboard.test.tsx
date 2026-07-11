import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockTenants = [
  {
    tenant: { id: '1', name: 'Acme Conf Group', status: 'active' },
    subscription: { status: 'active', plan: { limits: { attendees_per_event: 500 } } },
    users_count: 4, events_count: 2, attendees_count: 600, last_activity: null,
  },
  {
    tenant: { id: '2', name: 'Forum One', status: 'suspended' },
    subscription: { status: 'trial', trial_end_date: new Date(Date.now() + 2 * 86400000).toISOString(), plan: { limits: { attendees_per_event: 100 } } },
    users_count: 1, events_count: 1, attendees_count: 10, last_activity: null,
  },
];

const mockAnalytics = {
  tenants_by_status: { active: 1, suspended: 1 },
  tenants_by_plan: [{ plan: 'pro', count: 1 }],
  signups_by_week: [{ period: '2026-07-01', count: 5 }],
  active_events: 3,
  checkins_by_day: [{ period: '2026-07-09', count: 12 }, { period: '2026-07-10', count: 34 }],
  total_tenants: 2,
  paid_tenants: 1,
  paid_conversion: 0.5,
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('analytics')) return Promise.resolve({ data: mockAnalytics });
      return Promise.resolve({ data: mockTenants });
    });
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'active' } });
  });

  it('renders the over-limit queue with the tenant that exceeds its limit', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    // 'Acme Conf Group' legitimately appears twice on the page with this mock data (over-limit
    // queue + top-tenants-by-usage chart, since it's also the highest-attendee tenant), so we
    // scope the assertion to the "Over limit" card specifically rather than asserting presence
    // anywhere on the page — that way this test still fails if the over-limit queue itself is
    // broken (e.g. renders "Nothing here right now" instead of the tenant).
    await waitFor(() => expect(screen.getAllByText('Acme Conf Group').length).toBeGreaterThan(0));

    const overLimitHeading = screen.getByText(/Over limit|Превышен лимит/);
    const overLimitCard = overLimitHeading.closest('.rounded-lg');
    expect(overLimitCard).not.toBeNull();
    expect(within(overLimitCard as HTMLElement).getByText('Acme Conf Group')).toBeInTheDocument();
  });

  it('calls the reactivate endpoint when clicking Reactivate in the recently-suspended queue', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/Reactivate|Активировать/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/Reactivate|Активировать/)[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/reactivate')));
  });
});
