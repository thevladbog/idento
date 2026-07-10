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
      { tenant: { id: '1' }, attendees_count: 600, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
      { tenant: { id: '2' }, attendees_count: 100, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
  it('never flags an unlimited (-1) plan regardless of usage', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, attendees_count: 999999, subscription: { plan: { limits: { attendees_per_event: -1 } } } },
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
