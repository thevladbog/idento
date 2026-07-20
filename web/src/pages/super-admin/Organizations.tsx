import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { trialsEndingWithinDays, overLimitTenants, onCustomLimitTenants, resolvedLimit, type TenantStat } from '@/lib/tenantQueues';
import { meterTone, meterToneClass } from '@/lib/meters';

export default function Organizations() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<TenantStat[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<TenantStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [savedQueue, setSavedQueue] = useState<'all' | 'trials' | 'over_limit' | 'suspended' | 'custom_limits'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 14;
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    setPage(1);
    filterTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter when search/plan/status/savedQueue/tenants change
  }, [searchQuery, planFilter, statusFilter, savedQueue, tenants]);

  const loadTenants = async () => {
    try {
      const response = await api.get('/api/super-admin/tenants');
      setTenants(response.data);
      setFilteredTenants(response.data);
    } catch (error) {
      console.error('Failed to load tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async () => {
    const trimmedName = tenantName.trim();
    if (!trimmedName) return;

    setCreating(true);
    try {
      await api.post('/api/super-admin/tenants', { name: trimmedName });
      toast.success(t('createTenantDone'));
      setTenantName('');
      setDialogOpen(false);
      await loadTenants();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('createTenantFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setTenantName('');
    }
  };

  function applySavedQueue(list: TenantStat[]): TenantStat[] {
    switch (savedQueue) {
      case 'trials':
        return trialsEndingWithinDays(list, 7);
      case 'over_limit':
        return overLimitTenants(list);
      case 'suspended':
        return list.filter((t) => t.tenant?.status === 'suspended');
      case 'custom_limits':
        return onCustomLimitTenants(list);
      default:
        return list;
    }
  }

  const filterTenants = () => {
    type TenantRow = { tenant?: { name?: string; contact_email?: string; status?: string }; subscription?: { plan?: { slug?: string }; status?: string } };
    let filtered = [...applySavedQueue(tenants)];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter((t: TenantRow) =>
        t.tenant?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tenant?.contact_email?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Plan filter
    if (planFilter !== 'all') {
      filtered = filtered.filter((t: TenantRow) =>
        t.subscription?.plan?.slug === planFilter
      );
    }

    // Status filter (tenant lifecycle status, not subscription status)
    if (statusFilter !== 'all') {
      filtered = filtered.filter((t: TenantRow) =>
        (t.tenant?.status ?? 'active') === statusFilter
      );
    }

    setFilteredTenants(filtered);
  };

  const getPlanBadgeVariant = (tier: string) => {
    switch (tier) {
      case 'free': return 'secondary';
      case 'starter': return 'default';
      case 'pro': return 'default';
      case 'enterprise': return 'default';
      default: return 'outline';
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'active': return 'default';
      case 'trial': return 'secondary';
      case 'expired': return 'destructive';
      case 'cancelled': return 'outline';
      default: return 'outline';
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const pageStart = (page - 1) * PAGE_SIZE;
  const pagedTenants = filteredTenants.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="p-8">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('organizations')}</h1>
          <p className="text-muted-foreground">{t('manageAllOrganizations')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          + {t('createTenant')}
        </Button>
      </div>

      {/* Saved queues */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ['all', t('savedQueueAll'), tenants.length],
          ['trials', t('savedQueueTrialsExpiring'), trialsEndingWithinDays(tenants, 7).length],
          ['over_limit', t('savedQueueOverLimit'), overLimitTenants(tenants).length],
          ['suspended', t('savedQueueSuspended'), tenants.filter((t) => t.tenant?.status === 'suspended').length],
          ['custom_limits', t('savedQueueCustomLimits'), onCustomLimitTenants(tenants).length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSavedQueue(key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              savedQueue === key
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {label} · {count}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <Input
          placeholder={t('searchOrganizations')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allPlans')}</SelectItem>
            <SelectItem value="free">{t("planFree")}</SelectItem>
            <SelectItem value="starter">{t("planStarter")}</SelectItem>
            <SelectItem value="pro">{t("planProfessional")}</SelectItem>
            <SelectItem value="enterprise">{t("planEnterprise")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            <SelectItem value="active">{t('tenantStatus_active')}</SelectItem>
            <SelectItem value="suspended">{t('tenantStatus_suspended')}</SelectItem>
            <SelectItem value="archived">{t('tenantStatus_archived')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('plan')}</TableHead>
              <TableHead>{t('users')}</TableHead>
              <TableHead>{t('events')}</TableHead>
              <TableHead>{t('attendees')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{t('tenantStatusColumn')}</TableHead>
              <TableHead>{t('created')}</TableHead>
              <TableHead>{t('lastActivityColumn')}</TableHead>
              <TableHead>{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  {t('noOrganizationsFound')}
                </TableCell>
              </TableRow>
            ) : (
              pagedTenants.map((tenant: { tenant?: { id?: string; name?: string; status?: string; created_at?: string }; subscription?: { plan?: { name?: string; tier?: string; slug?: string; limits?: Record<string, number> }; status?: string; custom_limits?: Record<string, number> | null }; users_count?: number; events_count?: number; attendees_count?: number; last_activity?: string | null }) => (
                <TableRow key={tenant.tenant?.id ?? ''}>
                  <TableCell className="font-medium">{tenant.tenant?.name}</TableCell>
                  <TableCell>
                    <Badge variant={getPlanBadgeVariant(tenant.subscription?.plan?.tier ?? '')}>
                      {tenant.subscription?.plan?.name || 'N/A'}
                    </Badge>
                    {onCustomLimitTenants([tenant]).length > 0 && (
                      <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t('customPlanBadge')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{tenant.users_count}</TableCell>
                  <TableCell>{tenant.events_count}</TableCell>
                  <TableCell>
                    {(() => {
                      const limit = resolvedLimit(tenant.subscription, 'attendees_per_event');
                      const tone = meterTone(tenant.attendees_count ?? 0, limit);
                      return (
                        <span className={meterToneClass(tone)}>
                          {tenant.attendees_count ?? 0}
                          {limit !== -1 ? ` / ${limit}` : ''}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(tenant.subscription?.status ?? '')}>
                      {tenant.subscription?.status || 'N/A'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tenant.tenant?.status} />
                    {overLimitTenants([tenant]).length > 0 && (
                      <div className="mt-1 text-[10px] font-semibold text-destructive">{t('overLimitBadge')}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {tenant.tenant?.created_at ? new Date(tenant.tenant.created_at).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell>
                    {tenant.last_activity ? new Date(tenant.last_activity).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/organizations/${tenant.tenant?.id}`)}
                    >
                      {t('view')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t('paginationOf', {
            from: filteredTenants.length === 0 ? 0 : pageStart + 1,
            to: Math.min(pageStart + PAGE_SIZE, filteredTenants.length),
            total: filteredTenants.length,
          })}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            {t('previousPage')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pageStart + PAGE_SIZE >= filteredTenants.length}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('nextPage')}
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTenantTitle')}</DialogTitle>
            <DialogDescription>{t('createTenantDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              placeholder={t('tenantNamePlaceholder')}
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tenantName.trim() && !creating) {
                  handleCreateTenant();
                }
              }}
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              disabled={creating}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreateTenant}
              disabled={creating || !tenantName.trim()}
            >
              {creating ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

