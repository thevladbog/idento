import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

// Single-currency system: prices are rubles, same as SubscriptionPlans.tsx.
function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU')} ₽`;
}

type CatalogKind = 'plan' | 'service' | 'addon';
type CatalogPeriod = 'month' | 'year';
type CatalogActivation = 'on_payment' | 'after_current' | 'manual';
type CatalogLimitKey = 'attendees_per_event' | 'events_per_month' | 'users';
type CatalogValidity = 'until_period_end' | 'fixed_days';

interface CatalogItem {
  id?: string;
  kind: CatalogKind;
  name: string;
  description: string;
  price: number;
  vat_rate: number | null;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  plan_id: string | null;
  period: CatalogPeriod | null;
  default_activation: CatalogActivation | null;
  limit_key: CatalogLimitKey | null;
  limit_delta: number | null;
  validity: CatalogValidity | null;
  validity_days: number | null;
}

interface PlanOption {
  id: string;
  name: string;
}

const VAT_RATES = [5, 7, 10, 20];
const VAT_NONE = 'none';

const emptyItem: CatalogItem = {
  kind: 'service',
  name: '',
  description: '',
  price: 0,
  vat_rate: null,
  is_public: true,
  is_active: true,
  sort_order: 0,
  plan_id: null,
  period: null,
  default_activation: null,
  limit_key: null,
  limit_delta: null,
  validity: null,
  validity_days: null,
};

export default function BillingCatalog() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formData, setFormData] = useState<CatalogItem>(emptyItem);

  const loadItems = async () => {
    try {
      const [itemsRes, plansRes] = await Promise.all([
        api.get('/api/super-admin/billing/catalog?include_inactive=true'),
        api.get('/api/super-admin/plans?include_inactive=true'),
      ]);
      setItems(itemsRes.data || []);
      setPlans(plansRes.data || []);
    } catch (error) {
      console.error('Failed to load billing catalog:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the data-loading routine synchronously raises its loading flag before the async fetch; the fetch-effect pattern is this console's established data layer (no query library here)
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const openCreateDialog = () => {
    setEditingItem(null);
    setFormData(emptyItem);
    setShowDialog(true);
  };

  const openEditDialog = (item: CatalogItem) => {
    setEditingItem(item);
    setFormData({ ...item });
    setShowDialog(true);
  };

  const setKind = (kind: CatalogKind) => {
    setFormData((prev) => {
      const next: CatalogItem = {
        ...prev,
        kind,
        plan_id: null,
        period: null,
        default_activation: null,
        limit_key: null,
        limit_delta: null,
        validity: null,
        validity_days: null,
      };
      if (kind === 'plan') {
        next.plan_id = plans[0]?.id ?? '';
        next.period = 'month';
        next.default_activation = 'on_payment';
      } else if (kind === 'addon') {
        next.limit_key = 'attendees_per_event';
        next.limit_delta = 0;
        next.validity = 'until_period_end';
      }
      return next;
    });
  };

  const validate = (): boolean => {
    if (!formData.name.trim()) return false;
    if (formData.price < 0) return false;
    if (formData.kind === 'plan') {
      if (!formData.plan_id || !formData.period || !formData.default_activation) return false;
    }
    if (formData.kind === 'addon') {
      if (!formData.limit_key || formData.limit_delta === null || !formData.validity) return false;
      if (formData.validity === 'fixed_days' && !formData.validity_days) return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.error(t('fillRequiredFields'));
      return;
    }
    try {
      if (editingItem) {
        await api.put(`/api/super-admin/billing/catalog/${editingItem.id}`, formData);
      } else {
        await api.post('/api/super-admin/billing/catalog', formData);
      }
      toast.success(t('billingItemSaved'));
      setShowDialog(false);
      loadItems();
    } catch (error: unknown) {
      console.error('Failed to save catalog item:', error);
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('billingSaveFailed'));
    }
  };

  const kindLabel = (kind: CatalogKind) => {
    if (kind === 'plan') return t('billingKindPlan');
    if (kind === 'addon') return t('billingKindAddon');
    return t('billingKindService');
  };

  const limitKeyLabel = (key: CatalogLimitKey) => {
    if (key === 'attendees_per_event') return t('billingLimitAttendees');
    if (key === 'events_per_month') return t('billingLimitEvents');
    return t('billingLimitUsers');
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
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('billingCatalog')}</h1>
          <p className="text-muted-foreground">{t('billingCatalogSubtitle')}</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('billingCatalogAddItem')}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('name')}</TableHead>
            <TableHead>{t('type')}</TableHead>
            <TableHead>{t('price')}</TableHead>
            <TableHead>{t('billingVatLabel')}</TableHead>
            <TableHead>{t('visibility')}</TableHead>
            <TableHead>{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{kindLabel(item.kind)}</Badge>
              </TableCell>
              <TableCell>{formatRub(item.price)}</TableCell>
              <TableCell>
                {item.vat_rate === null
                  ? t('billingNoVat')
                  : t('billingVatIncluded', { rate: item.vat_rate })}
              </TableCell>
              <TableCell>
                <div className="flex gap-1.5">
                  {item.is_public && <Badge variant="secondary">{t('billingPublicBadge')}</Badge>}
                  {!item.is_active && <Badge variant="outline">{t('billingInactiveBadge')}</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => openEditDialog(item)}>
                  {t('edit')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? t('edit') : t('billingCatalogAddItem')}</DialogTitle>
            <DialogDescription>{t('billingCatalogSubtitle')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="billing-item-kind">{t('type')}</Label>
              <Select value={formData.kind} onValueChange={(value) => setKind(value as CatalogKind)}>
                <SelectTrigger id="billing-item-kind" aria-label={t('type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">{t('billingKindPlan')}</SelectItem>
                  <SelectItem value="service">{t('billingKindService')}</SelectItem>
                  <SelectItem value="addon">{t('billingKindAddon')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="billing-item-name">{t('name')}</Label>
                <Input
                  id="billing-item-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="billing-item-price">{t('price')}</Label>
                <Input
                  id="billing-item-price"
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="billing-item-description">{t('description')}</Label>
              <Textarea
                id="billing-item-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="billing-item-vat">{t('billingVatLabel')}</Label>
                <Select
                  value={formData.vat_rate === null ? VAT_NONE : String(formData.vat_rate)}
                  onValueChange={(value) =>
                    setFormData({ ...formData, vat_rate: value === VAT_NONE ? null : Number(value) })
                  }
                >
                  <SelectTrigger id="billing-item-vat" aria-label={t('billingVatLabel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VAT_NONE}>{t('billingNoVat')}</SelectItem>
                    {VAT_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="billing-item-sort-order">{t('sortOrder')}</Label>
                <Input
                  id="billing-item-sort-order"
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
            </div>

            {formData.kind === 'plan' && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="billing-item-plan">{t('plan')}</Label>
                  <Select
                    value={formData.plan_id ?? ''}
                    onValueChange={(value) => setFormData({ ...formData, plan_id: value })}
                  >
                    <SelectTrigger id="billing-item-plan" aria-label={t('plan')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="billing-item-period">{t('billingPeriodLabel')}</Label>
                  <Select
                    value={formData.period ?? ''}
                    onValueChange={(value) => setFormData({ ...formData, period: value as CatalogPeriod })}
                  >
                    <SelectTrigger id="billing-item-period" aria-label={t('billingPeriodLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="month">{t('billingPeriodMonth')}</SelectItem>
                      <SelectItem value="year">{t('billingPeriodYear')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="billing-item-activation">{t('billingActivationLabel')}</Label>
                  <Select
                    value={formData.default_activation ?? ''}
                    onValueChange={(value) =>
                      setFormData({ ...formData, default_activation: value as CatalogActivation })
                    }
                  >
                    <SelectTrigger id="billing-item-activation" aria-label={t('billingActivationLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on_payment">{t('billingActivationOnPayment')}</SelectItem>
                      <SelectItem value="after_current">{t('billingActivationAfterCurrent')}</SelectItem>
                      <SelectItem value="manual">{t('billingActivationManual')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {formData.kind === 'addon' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="billing-item-limit-key">{t('billingLimitKeyLabel')}</Label>
                  <Select
                    value={formData.limit_key ?? ''}
                    onValueChange={(value) => setFormData({ ...formData, limit_key: value as CatalogLimitKey })}
                  >
                    <SelectTrigger id="billing-item-limit-key" aria-label={t('billingLimitKeyLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="attendees_per_event">{limitKeyLabel('attendees_per_event')}</SelectItem>
                      <SelectItem value="events_per_month">{limitKeyLabel('events_per_month')}</SelectItem>
                      <SelectItem value="users">{limitKeyLabel('users')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="billing-item-limit-delta">{t('billingLimitDeltaLabel')}</Label>
                  <Input
                    id="billing-item-limit-delta"
                    type="number"
                    value={formData.limit_delta ?? 0}
                    onChange={(e) => setFormData({ ...formData, limit_delta: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
                <div>
                  <Label htmlFor="billing-item-validity">{t('billingValidityLabel')}</Label>
                  <Select
                    value={formData.validity ?? ''}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        validity: value as CatalogValidity,
                        validity_days: value === 'fixed_days' ? formData.validity_days ?? 30 : null,
                      })
                    }
                  >
                    <SelectTrigger id="billing-item-validity" aria-label={t('billingValidityLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="until_period_end">{t('billingValidityUntilPeriodEnd')}</SelectItem>
                      <SelectItem value="fixed_days">{t('billingValidityFixedDays')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formData.validity === 'fixed_days' && (
                  <div>
                    <Label htmlFor="billing-item-validity-days">{t('billingValidityDaysLabel')}</Label>
                    <Input
                      id="billing-item-validity-days"
                      type="number"
                      value={formData.validity_days ?? 0}
                      onChange={(e) =>
                        setFormData({ ...formData, validity_days: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                )}
              </div>
            )}

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
            <Button onClick={handleSave}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
