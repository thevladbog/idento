import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';
import { AuditEntryList } from '@/components/AuditEntryList';
import { TenantCombobox, type TenantOption } from '@/components/TenantCombobox';
import type { AuditLogEntry } from '@/lib/auditFormat';

const KNOWN_ACTIONS = [
  'create_tenant',
  'suspend_tenant',
  'reactivate_tenant',
  'archive_tenant',
  'impersonate_tenant',
  'impersonated_request',
  'create_subscription',
  'update_subscription',
  'create_plan',
  'update_plan',
];

const PAGE_SIZE = 50;

type Admin = { id: string; email: string; is_super_admin: boolean };

export default function AuditLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [planNames, setPlanNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .get('/api/super-admin/users', { params: { page_size: 100 } })
      .then((res) => setAdmins((res.data.users || []).filter((u: Admin) => u.is_super_admin)))
      .catch(() => {
        /* best-effort: actor filter just shows no options if this fails */
      });
    api
      .get('/api/super-admin/tenants')
      .then((res) =>
        setTenants(
          (res.data || [])
            .map((t: { tenant?: { id?: string; name?: string } }) => ({ id: t.tenant?.id, name: t.tenant?.name }))
            .filter((tn: TenantOption) => tn.id && tn.name)
        )
      )
      .catch(() => {
        /* best-effort: tenant filter just shows no options if this fails */
      });
    api
      .get('/api/super-admin/plans')
      .then((res) =>
        setPlanNames(Object.fromEntries((res.data || []).map((p: { id: string; name: string }) => [p.id, p.name])))
      )
      .catch(() => {
        /* best-effort: plan-change diffs fall back to a shortened plan id if this fails */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const filtersKey = JSON.stringify({ actionFilter, actorFilter, tenantFilter, dateFrom, dateTo });
  const prevFiltersKeyRef = useRef(filtersKey);
  // Tracks the (filtersKey, offset) pair the last fetch was issued for, so
  // that the setOffset(0) call below — which re-triggers this same effect
  // via the `offset` dependency once React commits it — doesn't cause a
  // second, redundant fetch for the exact same params.
  const lastFetchedRef = useRef<{ filtersKey: string; offset: number } | null>(null);

  useEffect(() => {
    const filtersChanged = prevFiltersKeyRef.current !== filtersKey;
    prevFiltersKeyRef.current = filtersKey;
    const effectiveOffset = filtersChanged ? 0 : offset;
    if (filtersChanged && offset !== 0) {
      setOffset(0); // keep pagination button state in sync; the fetch below doesn't wait for this
    }
    const already = lastFetchedRef.current;
    if (already && already.filtersKey === filtersKey && already.offset === effectiveOffset) {
      return;
    }
    lastFetchedRef.current = { filtersKey, offset: effectiveOffset };
    loadLogs(effectiveOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtersKey captures all filter deps; offset is read explicitly above
  }, [filtersKey, offset]);

  const loadLogs = async (offsetToUse: number) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: offsetToUse };
      if (actionFilter !== 'all') params.action = actionFilter;
      if (actorFilter !== 'all') params.admin_user_id = actorFilter;
      if (tenantFilter) params.target_id = tenantFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await api.get('/api/super-admin/audit-log', { params });
      setLogs(response.data.logs || []);
      setTotal(response.data.total || 0);
    } catch (error) {
      console.error('Failed to load audit log:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('auditLog')}</h1>
        <p className="text-muted-foreground">{t('adminActionsLog')}</p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('action')}</Label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allActions')}</SelectItem>
              {KNOWN_ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>{action}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('auditLog_actorLabel')}</Label>
          <Select value={actorFilter} onValueChange={setActorFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('auditLog_allAdmins')}</SelectItem>
              {admins.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('auditLog_tenantLabel')}</Label>
          <TenantCombobox tenants={tenants} value={tenantFilter} onChange={setTenantFilter} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="audit-date-from" className="text-xs text-muted-foreground">{t('auditLog_dateFromLabel')}</Label>
          <Input
            id="audit-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-date-to" className="text-xs text-muted-foreground">{t('auditLog_dateToLabel')}</Label>
          <Input
            id="audit-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      <div className="border rounded-lg p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <AuditEntryList entries={logs} planNames={planNames} emptyLabel={t('noLogsFound')} />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t('paginationOf', {
            from: total === 0 ? 0 : offset + 1,
            to: Math.min(offset + PAGE_SIZE, total),
            total,
          })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            {t('previousPage')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            {t('nextPage')}
          </Button>
        </div>
      </div>
    </div>
  );
}
