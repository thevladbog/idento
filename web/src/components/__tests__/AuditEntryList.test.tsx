import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditEntryList } from '../AuditEntryList';
import type { AuditLogEntry } from '@/lib/auditFormat';
import '../../i18n';

const entries: AuditLogEntry[] = [
  {
    id: '1',
    admin_user_id: 'admin-1',
    action: 'suspend_tenant',
    target_type: 'tenant',
    target_id: 'tenant-1',
    changes: { from: 'active', to: 'suspended' },
    ip_address: null,
    user_agent: null,
    created_at: '2026-07-11T10:00:00Z',
  },
];

describe('AuditEntryList', () => {
  it('renders a day-group heading and the formatted diff line', () => {
    render(<AuditEntryList entries={entries} emptyLabel="No activity" />);
    expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument();
  });

  it('renders the empty label when there are no entries', () => {
    render(<AuditEntryList entries={[]} emptyLabel="No activity yet" />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });
});
