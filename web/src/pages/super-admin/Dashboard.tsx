import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, CalendarClock, CheckCircle2, TrendingUp, Users, Zap } from 'lucide-react';
import {
  trialsEndingWithinDays,
  overLimitTenants,
  resolvedLimit,
  type TenantStat,
} from '@/lib/tenantQueues';
import { meterTone, meterToneClass } from '@/lib/meters';
import { BarRow } from '@/components/BarRow';

type PlatformAnalytics = {
  tenants_by_plan: { plan: string; count: number }[] | null;
  signups_by_week: { period: string; count: number }[] | null;
  checkins_by_day: { period: string; count: number }[] | null;
  active_events: number;
  paid_conversion: number;
};

export default function SuperAdminDashboard() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<TenantStat[]>([]);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [tenantsRes, analyticsRes] = await Promise.all([
        api.get('/api/super-admin/tenants'),
        api.get('/api/super-admin/analytics'),
      ]);
      setTenants(tenantsRes.data || []);
      setAnalytics(analyticsRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'), { description: t('failedToLoadData') });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function handleReactivate(id: string) {
    setReactivatingId(id);
    try {
      await api.post(`/api/super-admin/tenants/${id}/reactivate`);
      toast.success(t('reactivateDone'));
      await load();
    } catch {
      toast.error(t('reactivateFailed'));
    } finally {
      setReactivatingId(null);
    }
  }

  if (loading) {
    return <div className="p-8 animate-pulse text-muted-foreground">…</div>;
  }

  const activeTenants = tenants.filter((t) => t.tenant?.status === 'active');
  const onTrial = tenants.filter((t) => t.subscription?.status === 'trial');
  const suspended = tenants.filter((t) => t.tenant?.status === 'suspended');
  const trialsSoon = trialsEndingWithinDays(tenants, 7);
  const overLimit = overLimitTenants(tenants);
  const checkinsToday = analytics?.checkins_by_day?.length
    ? analytics.checkins_by_day[analytics.checkins_by_day.length - 1].count
    : 0;

  const kpis = [
    { title: t('activeTenantsKpi'), value: activeTenants.length, icon: Building2 },
    { title: t('onTrialKpi'), value: onTrial.length, icon: Zap },
    { title: t('suspendedKpi'), value: suspended.length, icon: CalendarClock },
    { title: t('paidConversionKpi'), value: `${((analytics?.paid_conversion ?? 0) * 100).toFixed(0)}%`, icon: TrendingUp },
    { title: t('activeEventsKpi'), value: analytics?.active_events ?? 0, icon: CheckCircle2 },
    { title: t('checkinsTodayKpi'), value: checkinsToday, icon: Users },
  ];

  const signups = analytics?.signups_by_week ?? [];
  const checkins = analytics?.checkins_by_day ?? [];
  const signupsMax = Math.max(1, ...signups.map((s) => s.count));
  const checkinsMax = Math.max(1, ...checkins.map((c) => c.count));
  const topTenants = [...tenants]
    .sort((a, b) => (b.attendees_count ?? 0) - (a.attendees_count ?? 0))
    .slice(0, 5);
  const topTenantsMax = Math.max(1, ...topTenants.map((t) => t.attendees_count ?? 0));

  return (
    <div className="p-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('trialsEndingQueue')} · {trialsSoon.length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {trialsSoon.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsInQueue')}</p>}
            {trialsSoon.map((tn) => (
              <div key={tn.tenant?.id} className="flex items-center justify-between text-sm">
                <Link to={`/super-admin/organizations/${tn.tenant?.id}`} className="hover:underline">
                  {tn.tenant?.name}
                </Link>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/super-admin/organizations/${tn.tenant?.id}`}>{t('extendTrialAction')}</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('overLimitQueue')} · {overLimit.length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overLimit.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsInQueue')}</p>}
            {overLimit.map((tn) => {
              const limit = resolvedLimit(tn.subscription, 'attendees_per_event');
              const tone = meterTone(tn.attendees_count ?? 0, limit);
              return (
                <div key={tn.tenant?.id} className="flex items-center justify-between text-sm">
                  <span>
                    {tn.tenant?.name}{' '}
                    <span className={meterToneClass(tone)}>
                      ({tn.attendees_count}{limit !== -1 ? `/${limit}` : ''})
                    </span>
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/super-admin/organizations/${tn.tenant?.id}`}>{t('reviewAction')}</Link>
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('recentlySuspendedQueue')} · {suspended.length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {suspended.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsInQueue')}</p>}
            {suspended.map((tn) => (
              <div key={tn.tenant?.id} className="flex items-center justify-between text-sm">
                <Link to={`/super-admin/organizations/${tn.tenant?.id}`} className="hover:underline">
                  {tn.tenant?.name}
                </Link>
                <Button
                  size="sm"
                  disabled={reactivatingId === tn.tenant?.id}
                  onClick={() => tn.tenant?.id && handleReactivate(tn.tenant.id)}
                >
                  {t('reactivateAction')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('signupsByWeekChart')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {signups.map((s) => <BarRow key={s.period} label={s.period} count={s.count} max={signupsMax} />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('checkinsPerDayChart')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {checkins.map((c) => <BarRow key={c.period} label={c.period} count={c.count} max={checkinsMax} />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('tenantsByPlanChart')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(analytics?.tenants_by_plan ?? []).map((p) => (
              <BarRow key={p.plan} label={p.plan} count={p.count} max={Math.max(1, ...(analytics?.tenants_by_plan ?? []).map((x) => x.count))} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('topTenantsByUsage')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {topTenants.map((tn) => (
              <BarRow key={tn.tenant?.id} label={tn.tenant?.name ?? ''} count={tn.attendees_count ?? 0} max={topTenantsMax} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
