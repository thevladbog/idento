import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AuditLog from '../AuditLog';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

const mockLogs = {
  total: 1,
  limit: 50,
  offset: 0,
  logs: [
    {
      id: 'a1',
      admin_user_id: 'admin-1',
      action: 'suspend_tenant',
      target_type: 'tenant',
      target_id: 't1',
      changes: { from: 'active', to: 'suspended' },
      ip_address: null,
      user_agent: null,
      created_at: '2026-07-11T10:00:00Z',
    },
  ],
};
const mockAdmins = { users: [{ id: 'admin-1', email: 'ops@idento.com', role: 'admin', is_super_admin: true, created_at: '2026-01-01T00:00:00Z' }], total: 1 };
const mockTenants = [{ tenant: { id: 't1', name: 'Acme Corp' } }];
const mockPlans = [{ id: 'plan-pro', name: 'Professional' }];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/audit-log')) return Promise.resolve({ data: mockLogs });
    if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
    if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
    if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
    return Promise.reject(new Error('unexpected url ' + url));
  });
}

describe('AuditLog', () => {
  beforeEach(() => {
    mockApiGet();
  });

  it('renders fetched entries through AuditEntryList', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
  });

  it('re-fetches scoped to a tenant when one is picked from the combobox', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('combobox', { name: /all tenants/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('combobox', { name: /all tenants/i }));
    fireEvent.click(await screen.findByText('Acme Corp'));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.target_id).toBe('t1');
    });
  });

  it('includes the date range in the audit-log request when both dates are set', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '2026-07-11' } });
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.date_from).toBe('2026-07-01');
      expect(params.date_to).toBe('2026-07-11');
    });
  });

  it('disables Previous on the first page and enables Next when more rows exist', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/audit-log')) return Promise.resolve({ data: { ...mockLogs, total: 120 } });
      if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
      if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('requests the next page offset when Next is clicked', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/audit-log')) return Promise.resolve({ data: { ...mockLogs, total: 120 } });
      if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
      if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.offset).toBe(50);
    });
  });

  it('fires exactly one audit-log request (with offset reset to 0) when a filter changes while on page 2+', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/audit-log')) return Promise.resolve({ data: { ...mockLogs, total: 120 } });
      if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
      if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());

    // Move to page 2 (offset -> 50).
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.offset).toBe(50);
    });

    const auditLogCallCountBeforeFilterChange = vi
      .mocked(api.get)
      .mock.calls.filter(([u]) => (u as string).includes('/audit-log')).length;

    // Now change a filter while still on page 2 — this is the race: the
    // offset-reset effect and the load effect used to both fire off of the
    // stale `offset` closure, producing a wasted fetch at offset:50 before
    // the correct offset:0 fetch landed.
    fireEvent.click(screen.getByRole('combobox', { name: /all tenants/i }));
    fireEvent.click(await screen.findByText('Acme Corp'));

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.target_id).toBe('t1');
    });

    const auditLogCallsAfterFilterChange = vi
      .mocked(api.get)
      .mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
    expect(auditLogCallsAfterFilterChange.length - auditLogCallCountBeforeFilterChange).toBe(1);

    const lastCall = auditLogCallsAfterFilterChange[auditLogCallsAfterFilterChange.length - 1];
    const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
    expect(params.offset).toBe(0);
    expect(params.target_id).toBe('t1');
  });
});
