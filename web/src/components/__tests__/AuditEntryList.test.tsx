import { describe, it, expect, vi } from 'vitest';
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

  it('renders the day heading for the entry\'s grouped calendar day regardless of the viewer\'s timezone', () => {
    // Regression test: created_at is 2026-07-11T10:00:00Z, so groupAuditLogByDay buckets it
    // under '2026-07-11'. A viewer west of UTC (e.g. US Pacific, UTC-7 in July) must still see
    // a "July 11" heading — not "July 10" — even though new Date('2026-07-11') UTC-parses to a
    // local instant that falls on July 10 in that timezone.
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      render(<AuditEntryList entries={entries} emptyLabel="No activity" />);
      expect(screen.getByText('July 11, 2026')).toBeInTheDocument();
      expect(screen.queryByText('July 10, 2026')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
