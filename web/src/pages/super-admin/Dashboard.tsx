import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Users, Calendar, TrendingUp } from 'lucide-react';
import api from '@/lib/api';

export default function SuperAdminDashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState({
    totalTenants: 0,
    totalUsers: 0,
    totalEvents: 0,
    activeSubscriptions: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Load basic stats from tenants endpoint
      const response = await api.get('/api/super-admin/tenants');
      const tenants = response.data;
      
      const totalTenants = tenants.length;
      type TenantStat = { users_count?: number; events_count?: number; subscription?: { status?: string } };
      const totalUsers = tenants.reduce((sum: number, t: TenantStat) => sum + (t.users_count || 0), 0);
      const totalEvents = tenants.reduce((sum: number, t: TenantStat) => sum + (t.events_count || 0), 0);
      const activeSubscriptions = tenants.filter((t: TenantStat) => t.subscription?.status === 'active').length;

      setStats({
        totalTenants,
        totalUsers,
        totalEvents,
        activeSubscriptions,
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: t('totalOrganizations'),
      value: stats.totalTenants,
      icon: Building2,
      color: 'text-blue-600',
    },
    {
      title: t('totalUsers'),
      value: stats.totalUsers,
      icon: Users,
      color: 'text-green-600',
    },
    {
      title: t('totalEvents'),
      value: stats.totalEvents,
      icon: Calendar,
      color: 'text-purple-600',
    },
    {
      title: t('activeSubscriptions'),
      value: stats.activeSubscriptions,
      icon: TrendingUp,
      color: 'text-orange-600',
    },
  ];

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

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('dashboard')}</h1>
        <p className="text-muted-foreground">{t('systemOverview')}</p>
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('systemHealth')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

