import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Users, Calendar, UserCheck } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { TenantIdentityHeader } from '@/components/TenantIdentityHeader';
import { AuditEntryList } from '@/components/AuditEntryList';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { SuspendTenantDialog } from '@/components/SuspendTenantDialog';
import { ArchiveSheet } from '@/components/ArchiveSheet';
import { useScrollSpy } from '@/hooks/useScrollSpy';
import { meterTone, meterToneClass } from '@/lib/meters';
import { resolvedLimit } from '@/lib/tenantQueues';
import type { AuditLogEntry } from '@/lib/auditFormat';

type TenantUser = { id: string; email: string; role: string; created_at: string };

interface TenantDetail {
  tenant?: { id?: string; name?: string; status?: string; website?: string; contact_email?: string; created_at?: string };
  subscription?: {
    plan_id?: string;
    status?: string;
    plan?: { name?: string; limits?: Record<string, number> };
    custom_limits?: Record<string, number> | null;
    admin_notes?: string;
  };
  users_count?: number;
  events_count?: number;
  attendees_count?: number;
}

type Plan = { id: string; name: string; price_monthly?: number };

const SECTIONS: Array<{ id: string; labelKey: string }> = [
  { id: 'summary', labelKey: 'td_nav_summary' },
  { id: 'subscription', labelKey: 'td_nav_subscription' },
  { id: 'lifecycle', labelKey: 'td_nav_lifecycle' },
  { id: 'users', labelKey: 'td_nav_users' },
];

export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [customLimits, setCustomLimits] = useState('{}');
  const [adminNotes, setAdminNotes] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [subscriptionReason, setSubscriptionReason] = useState('');

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const activeSection = useScrollSpy(SECTIONS.map((s) => s.id));

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when id changes
  }, [id]);

  const loadData = async () => {
    try {
      const [tenantResponse, plansResponse, auditResponse, usersResponse] = await Promise.all([
        api.get(`/api/super-admin/tenants/${id}/stats`),
        api.get('/api/super-admin/plans'),
        api.get(`/api/super-admin/audit-log?target_id=${id}&limit=100`),
        api.get(`/api/super-admin/users?tenant_id=${id}`),
      ]);

      setTenant(tenantResponse.data);
      setPlans(plansResponse.data);
      setAuditEntries(auditResponse.data.logs || []);
      setUsers(usersResponse.data.users || []);

      if (tenantResponse.data.subscription) {
        const sub = tenantResponse.data.subscription;
        setSelectedPlanId(sub.plan_id || '');
        setCustomLimits(JSON.stringify(sub.custom_limits || {}, null, 2));
        setAdminNotes(sub.admin_notes || '');
        setSubscriptionStatus(sub.status);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'), { description: t('failedToLoadData') });
    } finally {
      setLoading(false);
    }
  };

  const updateSubscription = async () => {
    if (subscriptionReason.trim() === '') return; // defense-in-depth; the button is also disabled
    try {
      setUpdating(true);
      let parsedLimits = {};
      try {
        parsedLimits = JSON.parse(customLimits);
      } catch {
        toast.error(t('error'), { description: t('invalidJSON') });
        return;
      }

      await api.patch(`/api/super-admin/tenants/${id}/subscription`, {
        plan_id: selectedPlanId || null,
        status: subscriptionStatus,
        custom_limits: parsedLimits,
        admin_notes: adminNotes,
        reason: subscriptionReason,
      });

      toast.success(t('success'), { description: t('subscriptionUpdated') });
      setSubscriptionReason('');
      loadData();
    } catch (error) {
      console.error('Failed to update subscription:', error);
      toast.error(t('error'), { description: t('failedToUpdateSubscription') });
    } finally {
      setUpdating(false);
    }
  };

  const runSuspend = async (reason: string) => {
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/suspend`, { reason });
      toast.success(t('lifecycle_suspend_done'));
      setSuspendOpen(false);
      await loadData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runArchive = async (reason: string) => {
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/archive`, { reason });
      toast.success(t('lifecycle_archive_done'));
      setArchiveOpen(false);
      await loadData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runReactivate = async () => {
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/reactivate`);
      toast.success(t('lifecycle_reactivate_done'));
      setReactivateOpen(false);
      await loadData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">{t('tenantNotFound')}</p>
      </div>
    );
  }

  const planNames = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const subscriptionAudit = auditEntries.filter((e) => e.action === 'update_subscription' || e.action === 'create_subscription');

  return (
    <div className="flex gap-8 p-8">
      <nav className="sticky top-20 hidden w-48 shrink-0 self-start space-y-1 lg:block">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`block rounded-md px-3 py-1.5 text-sm ${
              activeSection === s.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {t(s.labelKey)}
          </a>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/super-admin/organizations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
        <TenantIdentityHeader
          name={tenant.tenant?.name ?? ''}
          status={tenant.tenant?.status}
          planName={tenant.subscription?.plan?.name}
        />

        <ConfirmActionDialog
          open={reactivateOpen}
          onOpenChange={setReactivateOpen}
          title={t('lifecycle_reactivate_title')}
          description={t('lifecycle_reactivate_description', { tenant: tenant.tenant?.name })}
          confirmLabel={t('lifecycle_reactivate_confirm')}
          onConfirm={runReactivate}
          busy={lifecycleBusy}
        />
        <SuspendTenantDialog
          open={suspendOpen}
          onOpenChange={setSuspendOpen}
          tenantName={tenant.tenant?.name ?? ''}
          usersCount={tenant.users_count ?? 0}
          eventsCount={tenant.events_count ?? 0}
          onConfirm={runSuspend}
          busy={lifecycleBusy}
        />
        <ArchiveSheet
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          tenantName={tenant.tenant?.name ?? ''}
          usersCount={tenant.users_count ?? 0}
          eventsCount={tenant.events_count ?? 0}
          onConfirm={runArchive}
          busy={lifecycleBusy}
        />

        <div className="space-y-10">
          <section id="summary">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_summary')}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {(
                [
                  ['users', Users, tenant.users_count ?? 0, resolvedLimit(tenant.subscription, 'users')],
                  ['events', Calendar, tenant.events_count ?? 0, resolvedLimit(tenant.subscription, 'events_per_month')],
                  ['attendees', UserCheck, tenant.attendees_count ?? 0, resolvedLimit(tenant.subscription, 'attendees_per_event')],
                ] as const
              ).map(([key, Icon, count, limit]) => {
                const tone = meterTone(count, limit);
                return (
                  <Card key={key}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">{t(key)}</CardTitle>
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl font-bold ${meterToneClass(tone)}`}>
                        {count}
                        {limit !== -1 ? ` / ${limit}` : ''}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>{t('organizationInfo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{t('created')}</p>
                    <p className="font-medium">
                      {tenant.tenant?.created_at ? new Date(tenant.tenant.created_at).toLocaleString() : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('website')}</p>
                    <p className="font-medium">{tenant.tenant?.website || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('contactEmail')}</p>
                    <p className="font-medium">{tenant.tenant?.contact_email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('tenantId')}</p>
                    <p className="font-mono text-xs">{tenant.tenant?.id}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="subscription">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_subscription')}</h2>
            <Card>
              <CardHeader>
                <CardTitle>{t('subscriptionManagement')}</CardTitle>
                <CardDescription>{t('subscriptionManagementDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('plan')}</Label>
                    <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('selectPlan')} />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name} - ${plan.price_monthly ?? 0}/mo
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('status')}</Label>
                    <Select value={subscriptionStatus} onValueChange={setSubscriptionStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{t('active')}</SelectItem>
                        <SelectItem value="trial">{t('trial')}</SelectItem>
                        <SelectItem value="expired">{t('expired')}</SelectItem>
                        <SelectItem value="cancelled">{t('cancelled')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('customLimits')}</Label>
                  <Textarea
                    placeholder='{"events_per_month": 100, "users": 50}'
                    value={customLimits}
                    onChange={(e) => setCustomLimits(e.target.value)}
                    rows={6}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{t('customLimitsHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label>{t('adminNotes')}</Label>
                  <Textarea
                    placeholder={t('internalNotesPlaceholder')}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subscription-reason">{t('td_reasonRequiredLabel')}</Label>
                  <Textarea
                    id="subscription-reason"
                    value={subscriptionReason}
                    onChange={(e) => setSubscriptionReason(e.target.value)}
                    placeholder={t('td_subscriptionReasonPlaceholder')}
                    rows={2}
                  />
                </div>

                <Button onClick={updateSubscription} disabled={updating || subscriptionReason.trim() === ''}>
                  {updating ? t('updating') : t('updateSubscription')}
                </Button>
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">{t('td_subscriptionHistory')}</CardTitle>
              </CardHeader>
              <CardContent>
                <AuditEntryList entries={subscriptionAudit} planNames={planNames} emptyLabel={t('td_subscriptionHistoryEmpty')} />
              </CardContent>
            </Card>
          </section>

          <section id="lifecycle">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_lifecycle')}</h2>
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center gap-2 text-sm">
                  {(['active', 'suspended', 'archived'] as const).map((s, i, arr) => (
                    <div key={s} className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 ${
                          (tenant.tenant?.status ?? 'active') === s
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {t(`tenantStatus_${s}`)}
                      </span>
                      {i < arr.length - 1 && <span className="text-muted-foreground">→</span>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {tenant.tenant?.status === 'active' && (
                    <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                      {t('suspendTenant')}
                    </Button>
                  )}
                  {tenant.tenant?.status === 'suspended' && (
                    <>
                      <Button onClick={() => setReactivateOpen(true)}>{t('reactivateTenant')}</Button>
                      <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                        {t('archiveTenant')}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="users">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_users')}</h2>
            <Card>
              <CardContent className="pt-6">
                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('td_usersEmpty')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('email')}</TableHead>
                        <TableHead>{t('role')}</TableHead>
                        <TableHead>{t('created')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>{u.email}</TableCell>
                          <TableCell className="capitalize">{u.role}</TableCell>
                          <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
