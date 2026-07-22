import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

interface SubscriptionPlan {
  id?: string;
  name: string;
  slug: string;
  tier: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
}

type LimitFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

function LimitField({ label, value, onChange }: LimitFieldProps) {
  const { t } = useTranslation();
  const isUnlimited = value === -1;

  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          value={isUnlimited ? '' : value}
          disabled={isUnlimited}
          placeholder={isUnlimited ? t('planLimitUnlimited') : undefined}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        />
        <div className="flex items-center gap-1.5">
          <Switch
            checked={isUnlimited}
            onCheckedChange={(checked) => onChange(checked ? -1 : 0)}
            aria-label={`${label} — ${t('planLimitUnlimited')}`}
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">{t('planLimitUnlimited')}</span>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionPlans() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [formData, setFormData] = useState<SubscriptionPlan>({
    name: '',
    slug: '',
    tier: 'free',
    description: '',
    price_monthly: 0,
    price_yearly: 0,
    limits: {
      events_per_month: 10,
      attendees_per_event: 100,
      users: 3,
    },
    features: {
      custom_branding: false,
      api_access: false,
      priority_support: false,
    },
    is_active: true,
    is_public: true,
    sort_order: 0,
  });

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const loadPlans = async () => {
    try {
      const response = await api.get('/api/super-admin/plans?include_inactive=true');
      setPlans(response.data || []);
    } catch (error) {
      console.error('Failed to load plans:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingPlan(null);
    setFormData({
      name: '',
      slug: '',
      tier: 'free',
      description: '',
      price_monthly: 0,
      price_yearly: 0,
      limits: {
        events_per_month: 10,
        attendees_per_event: 100,
        users: 3,
      },
      features: {
        custom_branding: false,
        api_access: false,
        priority_support: false,
      },
      is_active: true,
      is_public: true,
      sort_order: 0,
    });
    setShowDialog(true);
  };

  const openEditDialog = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setFormData({
      ...plan,
      limits: plan.limits || {},
      features: plan.features || {},
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    try {
      if (editingPlan) {
        await api.put(`/api/super-admin/plans/${editingPlan.id}`, formData);
        toast.success(t('planUpdated'));
      } else {
        await api.post('/api/super-admin/plans', formData);
        toast.success(t('planCreated'));
      }
      setShowDialog(false);
      loadPlans();
    } catch (error) {
      console.error('Failed to save plan:', error);
      toast.error(t('failedToSavePlan'));
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('subscriptionPlans')}</h1>
          <p className="text-muted-foreground">{t('manageSubscriptionPlans')}</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('createPlan')}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan: SubscriptionPlan) => (
          <Card key={plan.id} className={!plan.is_active ? 'opacity-60' : ''}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                {!plan.is_active && <Badge variant="outline">{t('inactive')}</Badge>}
              </div>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-3xl font-bold">
                  ${plan.price_monthly}
                  <span className="text-sm text-muted-foreground font-normal">{t('perMonth')}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  ${plan.price_yearly}{t('perYear')}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm">{t('limits')}</h4>
                <ul className="text-sm space-y-1">
                  {plan.limits && Object.entries(plan.limits).map(([key, value]) => (
                    <li key={key} className="text-muted-foreground">
                      {key.replace(/_/g, ' ')}: {value === -1 ? t('unlimited') : value}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm">{t('features')}</h4>
                <ul className="text-sm space-y-1">
                  {plan.features && Object.entries(plan.features).map(([key, value]) => (
                    <li key={key} className="text-muted-foreground flex items-center gap-2">
                      {value ? '✓' : '✗'} {key.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </div>

              <Button variant="outline" className="w-full" onClick={() => openEditDialog(plan)}>
                {t('edit')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPlan ? t('editPlan') : t('createPlan')}
            </DialogTitle>
            <DialogDescription>
              {t('fillPlanDetails')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('name')}</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t("planPlaceholderName")}
                />
              </div>
              <div>
                <Label>{t('slug')}</Label>
                <Input
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  placeholder={t("planPlaceholderSlug")}
                />
              </div>
            </div>

            <div>
              <Label>{t('tier')}</Label>
              <Select value={formData.tier} onValueChange={(value) => setFormData({ ...formData, tier: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">{t("planFree")}</SelectItem>
                  <SelectItem value="starter">{t("planStarter")}</SelectItem>
                  <SelectItem value="pro">{t("planProfessional")}</SelectItem>
                  <SelectItem value="enterprise">{t("planEnterprise")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('description')}</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('priceMonthly')} ($)</Label>
                <Input
                  type="number"
                  value={formData.price_monthly}
                  onChange={(e) => setFormData({ ...formData, price_monthly: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <Label>{t('priceYearly')} ($)</Label>
                <Input
                  type="number"
                  value={formData.price_yearly}
                  onChange={(e) => setFormData({ ...formData, price_yearly: parseFloat(e.target.value) })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('limits')}</Label>
              <div className="grid grid-cols-3 gap-2">
                <LimitField
                  label={t('eventsPerMonth')}
                  value={formData.limits?.events_per_month ?? 0}
                  onChange={(v) => setFormData({ ...formData, limits: { ...formData.limits, events_per_month: v } })}
                />
                <LimitField
                  label={t('attendeesPerEvent')}
                  value={formData.limits?.attendees_per_event ?? 0}
                  onChange={(v) => setFormData({ ...formData, limits: { ...formData.limits, attendees_per_event: v } })}
                />
                <LimitField
                  label={t('users')}
                  value={formData.limits?.users ?? 0}
                  onChange={(v) => setFormData({ ...formData, limits: { ...formData.limits, users: v } })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>{t('active')}</Label>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>{t('public')}</Label>
              <Switch
                checked={formData.is_public}
                onCheckedChange={(checked) => setFormData({ ...formData, is_public: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

