import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StatusBadge } from '@/components/StatusBadge';
import { Building2, CreditCard, Percent, CalendarClock, AlertCircle } from 'lucide-react';
import api from '@/lib/api';

type TimeCount = { period: string; count: number };
type PlanCount = { plan: string; count: number };
type PlatformAnalytics = {
  tenants_by_status: Record<string, number>;
  tenants_by_plan: PlanCount[] | null;
  signups_by_week: TimeCount[] | null;
  active_events: number;
  checkins_by_day: TimeCount[] | null;
  total_tenants: number;
  paid_tenants: number;
  paid_conversion: number;
};

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-3 rounded bg-primary" style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 4}%` }} />
      <span className="tabular-nums">{count}</span>
    </div>
  );
}

export default function Analytics() {
  const { t } = useTranslation();
  const [data, setData] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/super-admin/analytics');
      setData(response.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || t('analyticsLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{t('analytics')}</h1>
          <p className="text-muted-foreground">{t('systemAnalytics')}</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || t('analyticsLoadFailed')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const tenantsByStatus = Object.entries(data.tenants_by_status ?? {});
  const tenantsByPlan = data.tenants_by_plan ?? [];
  const signupsByWeek = data.signups_by_week ?? [];
  const checkinsByDay = data.checkins_by_day ?? [];

  const signupsMax = Math.max(0, ...signupsByWeek.map((s) => s.count));
  const checkinsMax = Math.max(0, ...checkinsByDay.map((c) => c.count));

  const statCards = [
    { title: t('totalTenants'), value: data.total_tenants, icon: Building2, color: 'text-blue-600' },
    { title: t('paidTenants'), value: data.paid_tenants, icon: CreditCard, color: 'text-green-600' },
    { title: t('paidConversion'), value: `${(data.paid_conversion * 100).toFixed(1)}%`, icon: Percent, color: 'text-purple-600' },
    { title: t('activeEventsNow'), value: data.active_events, icon: CalendarClock, color: 'text-orange-600' },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('analytics')}</h1>
        <p className="text-muted-foreground">{t('systemAnalytics')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((card, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>{t('tenantsByStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            {tenantsByStatus.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noDataYet')}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {tenantsByStatus.map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <span className="tabular-nums text-sm text-muted-foreground">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('tenantsByPlan')}</CardTitle>
          </CardHeader>
          <CardContent>
            {tenantsByPlan.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noDataYet')}</p>
            ) : (
              <div className="space-y-2">
                {tenantsByPlan.map((p) => (
                  <div key={p.plan} className="flex items-center justify-between text-sm">
                    <span>{p.plan}</span>
                    <span className="tabular-nums font-medium">{p.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('signupsByWeek')}</CardTitle>
          </CardHeader>
          <CardContent>
            {signupsByWeek.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noDataYet')}</p>
            ) : (
              <div className="space-y-2">
                {signupsByWeek.map((s) => (
                  <BarRow key={s.period} label={s.period} count={s.count} max={signupsMax} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('checkinsByDay')}</CardTitle>
          </CardHeader>
          <CardContent>
            {checkinsByDay.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noDataYet')}</p>
            ) : (
              <div className="space-y-2">
                {checkinsByDay.map((c) => (
                  <BarRow key={c.period} label={c.period} count={c.count} max={checkinsMax} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
