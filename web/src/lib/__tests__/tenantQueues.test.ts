import { describe, it, expect } from 'vitest';
import { trialsEndingWithinDays, overLimitTenants, onCustomLimitTenants, resolvedLimit, type TenantStat } from '../tenantQueues';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

describe('resolvedLimit', () => {
  it('prefers a custom limit over the plan limit', () => {
    const sub: TenantStat['subscription'] = {
      custom_limits: { attendees_per_event: 10000 },
      plan: { limits: { attendees_per_event: 500 } },
    };
    expect(resolvedLimit(sub, 'attendees_per_event')).toBe(10000);
  });
  it('falls back to the plan limit when no custom override exists', () => {
    const sub: TenantStat['subscription'] = { plan: { limits: { events_per_month: 10 } } };
    expect(resolvedLimit(sub, 'events_per_month')).toBe(10);
  });
  it('defaults to unlimited (-1) when neither exists', () => {
    expect(resolvedLimit(undefined, 'users')).toBe(-1);
    expect(resolvedLimit({}, 'users')).toBe(-1);
  });

  it('adds an active boost total on top of the resolved plan limit', () => {
    const sub: TenantStat['subscription'] = { plan: { limits: { attendees_per_event: 500 } } };
    expect(resolvedLimit(sub, 'attendees_per_event', { attendees_per_event: 200 })).toBe(700);
  });

  it('adds an active boost total on top of a custom limit', () => {
    const sub: TenantStat['subscription'] = { custom_limits: { users: 10 } };
    expect(resolvedLimit(sub, 'users', { users: 5 })).toBe(15);
  });

  it('ignores boosts on an unlimited (-1) resolved limit', () => {
    const sub: TenantStat['subscription'] = { plan: { limits: { attendees_per_event: -1 } } };
    expect(resolvedLimit(sub, 'attendees_per_event', { attendees_per_event: 200 })).toBe(-1);
  });

  it('ignores a boost for an unrelated limit_key', () => {
    const sub: TenantStat['subscription'] = { plan: { limits: { attendees_per_event: 500 } } };
    expect(resolvedLimit(sub, 'attendees_per_event', { users: 200 })).toBe(500);
  });
});

describe('trialsEndingWithinDays', () => {
  it('includes only trial tenants whose trial_end_date is within the window', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, subscription: { status: 'trial', trial_end_date: daysFromNow(3) } },
      { tenant: { id: '2' }, subscription: { status: 'trial', trial_end_date: daysFromNow(20) } },
      { tenant: { id: '3' }, subscription: { status: 'active', trial_end_date: daysFromNow(3) } },
      { tenant: { id: '4' }, subscription: { status: 'trial', trial_end_date: null } },
    ];
    const result = trialsEndingWithinDays(tenants, 7);
    expect(result.map((t) => t.tenant?.id)).toEqual(['1']);
  });
});

describe('overLimitTenants', () => {
  it('flags a tenant over its attendees limit', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, max_attendees_per_event: 600, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
      { tenant: { id: '2' }, max_attendees_per_event: 100, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
  it('never flags an unlimited (-1) plan regardless of usage', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, max_attendees_per_event: 999999, subscription: { plan: { limits: { attendees_per_event: -1 } } } },
    ];
    expect(overLimitTenants(tenants)).toEqual([]);
  });
  it('flags a tenant over its events_per_month limit', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, events_this_month: 15, subscription: { plan: { limits: { events_per_month: 10 } } } },
      { tenant: { id: '2' }, events_this_month: 5, subscription: { plan: { limits: { events_per_month: 10 } } } },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
  // The Batch-1 audit's scope mismatch, fixed for real: cumulative
  // lifetime totals must never be compared against monthly/per-event
  // limits -- a long-lived tenant with 200 all-time events is NOT over a
  // 10-events-per-month limit if it created 2 this month.
  it('ignores cumulative events_count when the scoped events_this_month is within the monthly limit', () => {
    const tenants: TenantStat[] = [
      {
        tenant: { id: '1' },
        events_count: 200,
        events_this_month: 2,
        subscription: { plan: { limits: { events_per_month: 10 } } },
      },
    ];
    expect(overLimitTenants(tenants)).toEqual([]);
  });
  it('ignores cumulative attendees_count when the per-event peak is within the per-event limit', () => {
    const tenants: TenantStat[] = [
      {
        tenant: { id: '1' },
        attendees_count: 100000,
        max_attendees_per_event: 400,
        subscription: { plan: { limits: { attendees_per_event: 500 } } },
      },
    ];
    expect(overLimitTenants(tenants)).toEqual([]);
  });
  it('flags a per-event peak over the attendees_per_event limit', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, max_attendees_per_event: 501, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
  it('flags a tenant over its users limit', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, users_count: 12, subscription: { plan: { limits: { users: 10 } } } },
      { tenant: { id: '2' }, users_count: 3, subscription: { plan: { limits: { users: 10 } } } },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });

  // Billing sweep b315272 exposes active_boost_totals on the tenant list --
  // a tenant that would otherwise read as over-limit is NOT over-limit once
  // its boost is added to the base plan limit (500 + 200 = 700 >= 600).
  it('does not flag a tenant whose usage is within limit+boost', () => {
    const tenants: TenantStat[] = [
      {
        tenant: { id: '1' },
        max_attendees_per_event: 600,
        subscription: { plan: { limits: { attendees_per_event: 500 } } },
        active_boost_totals: { attendees_per_event: 200 },
      },
    ];
    expect(overLimitTenants(tenants)).toEqual([]);
  });

  it('still flags a tenant whose usage exceeds even limit+boost', () => {
    const tenants: TenantStat[] = [
      {
        tenant: { id: '1' },
        max_attendees_per_event: 800,
        subscription: { plan: { limits: { attendees_per_event: 500 } } },
        active_boost_totals: { attendees_per_event: 200 },
      },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });

  it('never flags an unlimited (-1) plan even with an active boost total', () => {
    const tenants: TenantStat[] = [
      {
        tenant: { id: '1' },
        max_attendees_per_event: 999999,
        subscription: { plan: { limits: { attendees_per_event: -1 } } },
        active_boost_totals: { attendees_per_event: 200 },
      },
    ];
    expect(overLimitTenants(tenants)).toEqual([]);
  });
});

describe('onCustomLimitTenants', () => {
  it('includes tenants with a non-empty custom_limits object', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, subscription: { custom_limits: { users: 20 } } },
      { tenant: { id: '2' }, subscription: { custom_limits: {} } },
      { tenant: { id: '3' }, subscription: { custom_limits: null } },
      { tenant: { id: '4' }, subscription: {} },
    ];
    expect(onCustomLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
});
