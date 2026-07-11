import { describe, it, expect, vi } from 'vitest';
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
    vi.stubEnv('TZ', 'UTC');
    try {
      const entries = [
        entry({ id: '1', created_at: '2026-07-11T10:00:00Z' }),
        entry({ id: '2', created_at: '2026-07-11T09:00:00Z' }),
        entry({ id: '3', created_at: '2026-07-10T10:00:00Z' }),
      ];
      const groups = groupAuditLogByDay(entries);
      expect(groups).toHaveLength(2);
      expect(groups[0]).toEqual({ day: '2026-07-11', entries: [entries[0], entries[1]] });
      expect(groups[1]).toEqual({ day: '2026-07-10', entries: [entries[2]] });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('groups by the VIEWER local calendar day, not UTC, for an entry near UTC midnight', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      // 2026-07-11T02:00:00Z is 2026-07-10T19:00:00 in America/Los_Angeles (UTC-7 in July) —
      // must group under the LOCAL day '2026-07-10', matching the local time a viewer sees.
      const entries = [entry({ id: '1', created_at: '2026-07-11T02:00:00Z' })];
      const groups = groupAuditLogByDay(entries);
      expect(groups).toEqual([{ day: '2026-07-10', entries }]);
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('renders plan creation', () => {
    const line = formatAuditDiff(entry({ action: 'create_plan', changes: { plan: { name: 'Professional' } } }));
    expect(line).toBe('Plan created: Professional');
  });

  it('renders plan updates as a field-level diff', () => {
    const line = formatAuditDiff(
      entry({
        action: 'update_plan',
        changes: {
          old: { name: 'Starter', price_monthly: 29, is_active: true },
          new: { name: 'Professional', price_monthly: 99, is_active: true },
        },
      })
    );
    expect(line).toBe('Name: Starter → Professional; Price/mo: 29 → 99');
  });

  it('falls back to a generic label when nothing tracked in a plan update changed', () => {
    const line = formatAuditDiff(
      entry({ action: 'update_plan', changes: { old: { name: 'Starter' }, new: { name: 'Starter' } } })
    );
    expect(line).toBe('Plan updated');
  });
});
