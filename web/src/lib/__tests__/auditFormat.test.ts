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

  // PR #58 follow-up: the retention purge job writes purge_tenant rows with
  // admin_user_id NULL (system actor) and { name, archived_at,
  // retention_days } in changes -- the type must admit the null and the
  // formatter must render the row meaningfully instead of the bare
  // "purge tenant" default.
  it('renders a purge_tenant entry (NULL system actor) with tenant name and retention window', () => {
    const line = formatAuditDiff(
      entry({
        action: 'purge_tenant',
        admin_user_id: null,
        changes: { name: 'Acme Corp', archived_at: '2026-04-01T00:00:00Z', retention_days: 90 },
      })
    );
    expect(line).toBe('Tenant "Acme Corp" permanently purged after 90-day retention');
  });

  it('renders a purge_tenant entry without a retention window when changes are sparse', () => {
    const line = formatAuditDiff(entry({ action: 'purge_tenant', admin_user_id: null, changes: {} }));
    expect(line).toBe('Tenant permanently purged');
  });

  // Billing sweep b315272: create_invoice_self_service is the tenant
  // self-service counterpart of the operator's create_invoice, distinct in
  // the audit trail but sharing the same { number, tenant_id, total }
  // payload shape.
  it('renders a create_invoice entry with the invoice number and total', () => {
    const line = formatAuditDiff(
      entry({ action: 'create_invoice', changes: { number: 'INV-0042', tenant_id: 't1', total: 5000 } })
    );
    expect(line).toBe('Invoice INV-0042 issued (5000)');
  });

  it('renders a create_invoice_self_service entry distinctly from an operator-issued one', () => {
    const line = formatAuditDiff(
      entry({ action: 'create_invoice_self_service', changes: { number: 'INV-0043', tenant_id: 't1', total: 1500 } })
    );
    expect(line).toBe('Invoice INV-0043 issued (1500) — self-service');
  });

  it('renders an invoice_paid entry with the invoice number', () => {
    const line = formatAuditDiff(
      entry({ action: 'invoice_paid', changes: { number: 'INV-0042', tenant_id: 't1', effects: {} } })
    );
    expect(line).toBe('Invoice INV-0042 marked paid');
  });

  it('renders an invoice_cancelled entry with a reason', () => {
    const line = formatAuditDiff(entry({ action: 'invoice_cancelled', changes: { reason: 'duplicate' } }));
    expect(line).toBe('Invoice cancelled — reason: duplicate');
  });

  it('renders catalog item creation', () => {
    const line = formatAuditDiff(entry({ action: 'create_catalog_item', changes: { item: { name: 'Extra users' } } }));
    expect(line).toBe('Catalog item created: Extra users');
  });

  it('renders catalog item updates as a field-level diff', () => {
    const line = formatAuditDiff(
      entry({
        action: 'update_catalog_item',
        changes: { old: { name: 'Extra users', price: 500 }, new: { name: 'Extra users', price: 750 } },
      })
    );
    expect(line).toBe('Price: 500 → 750');
  });

  it('groups NULL-actor entries by day like any other entry', () => {
    const groups = groupAuditLogByDay([
      entry({ id: 'p1', action: 'purge_tenant', admin_user_id: null, created_at: '2026-07-11T10:00:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries[0].admin_user_id).toBeNull();
  });
});
