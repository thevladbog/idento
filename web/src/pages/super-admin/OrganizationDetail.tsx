import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Users, Calendar, UserCheck } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  interface TenantDetail {
    tenant?: { id?: string; name?: string; website?: string; contact_email?: string; created_at?: string };
    subscription?: { plan_id?: string; status?: string; plan?: { name?: string } };
    users_count?: number;
    events_count?: number;
    attendees_count?: number;
  }
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [customLimits, setCustomLimits] = useState('{}');
  const [adminNotes, setAdminNotes] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when id changes
  }, [id]);

  const loadData = async () => {
    try {
      const [tenantResponse, plansResponse] = await Promise.all([
        api.get(`/api/super-admin/tenants/${id}/stats`),
        api.get('/api/super-admin/plans'),
      ]);

      setTenant(tenantResponse.data);
      setPlans(plansResponse.data);

      // Set current subscription values
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
      });

      toast.success(t('success'), { description: t('subscriptionUpdated') });

      loadData();
    } catch (error) {
      console.error('Failed to update subscription:', error);
      toast.error(t('error'), { description: t('failedToUpdateSubscription') });
    } finally {
      setUpdating(false);
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

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate('/super-admin/organizations')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{tenant.tenant?.name}</h1>
          <p className="text-muted-foreground">{t('organizationDetails')}</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('users')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tenant.users_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('events')}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tenant.events_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('attendees')}</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tenant.attendees_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('currentPlan')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="text-sm">
              {tenant.subscription?.plan?.name || 'N/A'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Management */}
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
                  {plans.map((plan: { id: string; name: string; price_monthly?: number }) => (
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
            <p className="text-xs text-muted-foreground">
              {t('customLimitsHint')}
            </p>
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

          <Button onClick={updateSubscription} disabled={updating}>
            {updating ? t('updating') : t('updateSubscription')}
          </Button>
        </CardContent>
      </Card>

      {/* Organization Info */}
      <Card>
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
    </div>
  );
}

