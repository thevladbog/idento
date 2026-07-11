import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OrganizationDetail from '../OrganizationDetail';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

const mockStats = {
  tenant: { id: 't1', name: 'Acme Corp', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  subscription: { plan_id: 'plan-pro', status: 'active', plan: { name: 'Professional', limits: { users: 10 } } },
  users_count: 4,
  events_count: 2,
  attendees_count: 600,
};
const mockPlans = [{ id: 'plan-pro', name: 'Professional', price_monthly: 99 }];
const mockAudit = { logs: [] };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/super-admin/organizations/t1']}>
      <Routes>
        <Route path="/super-admin/organizations/:id" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OrganizationDetail — Summary + Subscription sections', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: mockStats });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      if (url.includes('/audit-log')) return Promise.resolve({ data: mockAudit });
      return Promise.reject(new Error('unexpected url ' + url));
    });
  });

  it('renders the tenant identity header and usage meters', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(screen.getByText('4 / 10')).toBeInTheDocument(); // users_count vs plan's users limit
  });

  it('keeps the subscription save button disabled until a reason is typed', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    const saveButton = screen.getByRole('button', { name: /update subscription/i });
    expect(saveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason \(required/i), { target: { value: 'invoice #1042' } });
    expect(saveButton).not.toBeDisabled();
  });
});
