export type TenantStat = {
  tenant?: { id?: string; name?: string; status?: string };
  subscription?: {
    status?: string;
    trial_end_date?: string | null;
    custom_limits?: Record<string, number> | null;
    plan?: { name?: string; slug?: string; limits?: Record<string, number> };
  };
  users_count?: number;
  events_count?: number;
  attendees_count?: number;
  last_activity?: string | null;
};

const UNLIMITED = -1;

export function resolvedLimit(
  sub: TenantStat['subscription'] | undefined,
  key: 'events_per_month' | 'attendees_per_event' | 'users'
): number {
  const custom = sub?.custom_limits?.[key];
  if (typeof custom === 'number') return custom;
  const planLimit = sub?.plan?.limits?.[key];
  if (typeof planLimit === 'number') return planLimit;
  return UNLIMITED;
}

export function trialsEndingWithinDays(tenants: TenantStat[], days: number): TenantStat[] {
  const now = Date.now();
  const cutoff = now + days * 24 * 60 * 60 * 1000;
  return tenants.filter((t) => {
    if (t.subscription?.status !== 'trial') return false;
    if (!t.subscription.trial_end_date) return false;
    const end = new Date(t.subscription.trial_end_date).getTime();
    return end >= now && end <= cutoff;
  });
}

function isOverLimit(t: TenantStat): boolean {
  const checks: Array<['events_per_month' | 'attendees_per_event' | 'users', number]> = [
    ['events_per_month', t.events_count ?? 0],
    ['attendees_per_event', t.attendees_count ?? 0],
    ['users', t.users_count ?? 0],
  ];
  return checks.some(([key, count]) => {
    const limit = resolvedLimit(t.subscription, key);
    return limit !== UNLIMITED && count > limit;
  });
}

export function overLimitTenants(tenants: TenantStat[]): TenantStat[] {
  return tenants.filter(isOverLimit);
}

export function onCustomLimitTenants(tenants: TenantStat[]): TenantStat[] {
  return tenants.filter((t) => {
    const cl = t.subscription?.custom_limits;
    return !!cl && Object.keys(cl).length > 0;
  });
}
