import { describe, it, expect } from 'vitest';
import { groupAuditLogByDay, formatAuditDiff, type AuditLogEntry } from '../auditFormat';

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: '1',
    admin_user_id: 'admin-1',
    action: 'suspend_tenant',
    target_type: 'tenant',
    target_id: 'tenant-1',
    changes: {},
    ip_address: null,
    user_agent: null,
    created_at: '2026-07-11T10:00:00Z',
    ...overrides,
  };
}

describe('groupAuditLogByDay', () => {
  it('groups entries by their created_at date, preserving order within a day', () => {
    const entries = [
      entry({ id: '1', created_at: '2026-07-11T10:00:00Z' }),
      entry({ id: '2', created_at: '2026-07-11T09:00:00Z' }),
      entry({ id: '3', created_at: '2026-07-10T10:00:00Z' }),
    ];
    const groups = groupAuditLogByDay(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ day: '2026-07-11', entries: [entries[0], entries[1]] });
    expect(groups[1]).toEqual({ day: '2026-07-10', entries: [entries[2]] });
  });
});

describe('formatAuditDiff', () => {
  it('renders lifecycle transitions with reason', () => {
    const line = formatAuditDiff(entry({ action: 'suspend_tenant', changes: { from: 'active', to: 'suspended', reason: 'nonpayment' } }));
    expect(line).toBe('Status: active → suspended — reason: nonpayment');
  });

  it('renders lifecycle transitions without reason', () => {
    const line = formatAuditDiff(entry({ action: 'archive_tenant', changes: { from: 'suspended', to: 'archived' } }));
    expect(line).toBe('Status: suspended → archived');
  });

  it('renders impersonated_request as method + path', () => {
    const line = formatAuditDiff(entry({ action: 'impersonated_request', changes: { method: 'PATCH', path: '/api/events/123' } }));
    expect(line).toBe('PATCH /api/events/123');
  });

  it('renders subscription plan changes using the planNames lookup', () => {
    const line = formatAuditDiff(
      entry({
        action: 'update_subscription',
        changes: {
          old: { plan_id: 'plan-starter', status: 'trial' },
          new: { plan_id: 'plan-pro', status: 'active' },
          reason: 'invoice #1042',
        },
      }),
      { 'plan-starter': 'Starter', 'plan-pro': 'Professional' }
    );
    expect(line).toBe('Plan: Starter → Professional; Status: trial → active — reason: invoice #1042');
  });

  it('falls back to a generic label when nothing in the subscription diff changed', () => {
    const line = formatAuditDiff(
      entry({ action: 'update_subscription', changes: { old: { status: 'active' }, new: { status: 'active' }, reason: 'note only' } })
    );
    expect(line).toBe('Subscription updated — reason: note only');
  });
});
