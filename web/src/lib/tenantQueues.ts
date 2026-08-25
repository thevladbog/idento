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
  /** Live events created this calendar month -- the comparand for events_per_month. */
  events_this_month?: number;
  /** Peak live-attendee count of any live event -- the comparand for attendees_per_event. */
  max_attendees_per_event?: number;
  last_activity?: string | null;
  /**
   * List-view counterpart of a tenant's active limit boosts: summed delta
   * per limit_key across every currently-valid boost (set by the backend's
   * GetAllTenants in one grouped query, see billing sweep b315272). Absent
   * for a tenant with no active boosts.
   */
  active_boost_totals?: Record<string, number> | null;
};

const UNLIMITED = -1;

export function resolvedLimit(
  sub: TenantStat['subscription'] | undefined,
  key: 'events_per_month' | 'attendees_per_event' | 'users',
  boostTotals?: Record<string, number> | null
): number {
  const custom = sub?.custom_limits?.[key];
  const base = typeof custom === 'number' ? custom : sub?.plan?.limits?.[key];
  if (typeof base !== 'number' || base === UNLIMITED) return UNLIMITED;
  // Boosts are additive on top of whichever base limit resolved (custom or
  // plan) -- but never on an unlimited (-1) base, which already admits any
  // count and would otherwise "gain" a meaningless +N.
  const boost = boostTotals?.[key];
  return typeof boost === 'number' ? base + boost : base;
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
  // Each limit is compared against its OWN scope (the same counting rules
  // the backend's CheckTenantLimit/CheckAttendeeLimit enforce) -- never
  // against the cumulative lifetime totals, which only exist for display.
  const checks: Array<['events_per_month' | 'attendees_per_event' | 'users', number]> = [
    ['events_per_month', t.events_this_month ?? 0],
    ['attendees_per_event', t.max_attendees_per_event ?? 0],
    ['users', t.users_count ?? 0],
  ];
  return checks.some(([key, count]) => {
    const limit = resolvedLimit(t.subscription, key, t.active_boost_totals);
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
