export type AuditLogEntry = {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type AuditDayGroup = { day: string; entries: AuditLogEntry[] };

/** Groups by the entry's created_at calendar date (UTC, YYYY-MM-DD), preserving API order (newest-first) within each day. */
export function groupAuditLogByDay(entries: AuditLogEntry[]): AuditDayGroup[] {
  const order: string[] = [];
  const groups = new Map<string, AuditLogEntry[]>();
  for (const entry of entries) {
    const day = entry.created_at.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(day, [entry]);
      order.push(day);
    }
  }
  return order.map((day) => ({ day, entries: groups.get(day)! }));
}

function shortId(id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 8) : 'none';
}

/** Human-readable one-line description of a single audit entry's diff. */
export function formatAuditDiff(entry: AuditLogEntry, planNames?: Record<string, string>): string {
  const c = entry.changes ?? {};
  const reasonSuffix = typeof c.reason === 'string' && c.reason ? ` — reason: ${c.reason}` : '';

  switch (entry.action) {
    case 'suspend_tenant':
    case 'reactivate_tenant':
    case 'archive_tenant': {
      const from = typeof c.from === 'string' ? c.from : '?';
      const to = typeof c.to === 'string' ? c.to : '?';
      return `Status: ${from} → ${to}${reasonSuffix}`;
    }
    case 'impersonate_tenant':
      return `Support session started${reasonSuffix}`;
    case 'impersonated_request': {
      const method = typeof c.method === 'string' ? c.method : '';
      const path = typeof c.path === 'string' ? c.path : '';
      return `${method} ${path}`.trim();
    }
    case 'update_subscription':
    case 'create_subscription': {
      const oldSub = (c.old ?? {}) as Record<string, unknown>;
      const newSub = (c.new ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      const resolvePlan = (id: unknown) => (planNames?.[id as string] ?? shortId(id));
      if (oldSub.plan_id !== newSub.plan_id) {
        parts.push(`Plan: ${resolvePlan(oldSub.plan_id)} → ${resolvePlan(newSub.plan_id)}`);
      }
      if (oldSub.status !== newSub.status) {
        parts.push(`Status: ${oldSub.status ?? '?'} → ${newSub.status ?? '?'}`);
      }
      if (JSON.stringify(oldSub.custom_limits ?? {}) !== JSON.stringify(newSub.custom_limits ?? {})) {
        parts.push('Custom limits updated');
      }
      if (parts.length === 0) parts.push('Subscription updated');
      return parts.join('; ') + reasonSuffix;
    }
    case 'create_tenant':
      return 'Tenant created';
    default:
      return entry.action.replace(/_/g, ' ');
  }
}
