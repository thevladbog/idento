import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';

export default function Organizations() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [filteredTenants, setFilteredTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    filterTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter when search/plan/tenants change
  }, [searchQuery, planFilter, tenants]);

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

  const filterTenants = () => {
    type TenantRow = { tenant?: { name?: string; contact_email?: string }; subscription?: { plan?: { slug?: string }; status?: string } };
    let filtered = [...tenants];

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

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('organizations')}</h1>
        <p className="text-muted-foreground">{t('manageAllOrganizations')}</p>
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
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Professional</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
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
              <TableHead>{t('created')}</TableHead>
              <TableHead>{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {t('noOrganizationsFound')}
                </TableCell>
              </TableRow>
            ) : (
              filteredTenants.map((tenant: { tenant?: { id?: string; name?: string; created_at?: string }; subscription?: { plan?: { name?: string; tier?: string }; status?: string }; users_count?: number; events_count?: number; attendees_count?: number }) => (
                <TableRow key={tenant.tenant?.id ?? ''}>
                  <TableCell className="font-medium">{tenant.tenant?.name}</TableCell>
                  <TableCell>
                    <Badge variant={getPlanBadgeVariant(tenant.subscription?.plan?.tier ?? '')}>
                      {tenant.subscription?.plan?.name || 'N/A'}
                    </Badge>
                  </TableCell>
                  <TableCell>{tenant.users_count}</TableCell>
                  <TableCell>{tenant.events_count}</TableCell>
                  <TableCell>{tenant.attendees_count}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(tenant.subscription?.status ?? '')}>
                      {tenant.subscription?.status || 'N/A'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {tenant.tenant?.created_at ? new Date(tenant.tenant.created_at).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/super-admin/organizations/${tenant.tenant?.id}`)}
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

      <div className="mt-4 text-sm text-muted-foreground">
        {t('showing')} {filteredTenants.length} {t('of')} {tenants.length} {t('organizations')}
      </div>
    </div>
  );
}

