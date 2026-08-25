import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Label } from '@/components/ui/label';
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
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { TenantCombobox, type TenantOption } from '@/components/TenantCombobox';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU')} ₽`;
}

type InvoiceStatus = 'issued' | 'paid' | 'cancelled';
type CatalogKind = 'plan' | 'service' | 'addon';
type LineActivation = 'on_payment' | 'after_current' | 'manual' | null;
type LineLimitKey = 'attendees_per_event' | 'events_per_month' | 'users' | null;
type LineValidity = 'until_period_end' | 'fixed_days' | null;

interface InvoiceLine {
  id: string;
  position: number;
  catalog_item_id: string | null;
  kind: CatalogKind;
  name: string;
  price: number;
  vat_rate: number | null;
  activation: LineActivation;
  limit_key: LineLimitKey;
  limit_delta: number | null;
  validity: LineValidity;
  validity_days: number | null;
  quantity: number;
  amount: number;
}

interface Invoice {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name?: string;
  status: InvoiceStatus;
  issued_at: string;
  total: number;
  lines?: InvoiceLine[];
}

interface CatalogItem {
  id: string;
  kind: CatalogKind;
  name: string;
  price: number;
  vat_rate: number | null;
}

const STATUS_FILTERS: Array<'all' | InvoiceStatus> = ['all', 'issued', 'paid', 'cancelled'];

// Backend page size (backend/openapi.yaml ListInvoicesSuper: ?limit=, default
// 100, max 500). The list used to be silently capped at the backend default
// with no way to see older invoices past the first 100 — this keeps the
// same page size but paginates via ?offset= behind a "Show more" button
// instead of capping.
const PAGE_SIZE = 100;

export default function BillingInvoices() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createTenantId, setCreateTenantId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [creating, setCreating] = useState(false);

  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidBusy, setMarkPaidBusy] = useState(false);
  const [markPaidLoading, setMarkPaidLoading] = useState(false);

  const [cancelInvoice, setCancelInvoice] = useState<Invoice | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const loadInvoices = async (status: 'all' | InvoiceStatus, requestOffset: number, append: boolean) => {
    try {
      const params = { ...(status === 'all' ? {} : { status }), limit: PAGE_SIZE, offset: requestOffset };
      const res = await api.get('/api/super-admin/billing/invoices', { params });
      const rows: Invoice[] = res.data || [];
      setInvoices((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load invoices:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Resets to the first page — used whenever the status filter changes or an
  // action (mark-paid/cancel/create) mutates the list, so the view doesn't
  // end up showing a stale offset mixed with newly-changed rows.
  const reloadFirstPage = (status: 'all' | InvoiceStatus) => {
    setOffset(0);
    loadInvoices(status, 0, false);
  };

  const loadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    setOffset(nextOffset);
    loadInvoices(statusFilter, nextOffset, true);
  };

  const loadAuxData = async () => {
    try {
      const [tenantsRes, catalogRes] = await Promise.all([
        api.get('/api/super-admin/tenants'),
        api.get('/api/super-admin/billing/catalog'),
      ]);
      setTenants(
        (tenantsRes.data || [])
          .map((row: { tenant?: { id?: string; name?: string } }) => ({ id: row.tenant?.id, name: row.tenant?.name }))
          .filter((tn: TenantOption) => tn.id && tn.name)
      );
      setCatalog(catalogRes.data || []);
    } catch (error) {
      console.error('Failed to load billing aux data:', error);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the data-loading routine synchronously raises its loading flag before the async fetch; the fetch-effect pattern is this console's established data layer (no query library here)
    reloadFirstPage(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the status filter changes
  }, [statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load of tenants + catalog for the create dialog
    loadAuxData();
  }, []);

  const statusLabel = (status: InvoiceStatus) => {
    if (status === 'issued') return t('billingStatusIssued');
    if (status === 'paid') return t('billingStatusPaid');
    return t('billingStatusCancelled');
  };

  const statusBadgeVariant = (status: InvoiceStatus): 'default' | 'secondary' | 'outline' => {
    if (status === 'issued') return 'default';
    if (status === 'paid') return 'secondary';
    return 'outline';
  };

  const kindLabel = (kind: CatalogKind) => {
    if (kind === 'plan') return t('billingKindPlan');
    if (kind === 'addon') return t('billingKindAddon');
    return t('billingKindService');
  };

  const limitKeyLabel = (key: LineLimitKey) => {
    if (key === 'attendees_per_event') return t('billingLimitAttendees');
    if (key === 'events_per_month') return t('billingLimitEvents');
    return t('billingLimitUsers');
  };

  const activationLabel = (activation: LineActivation) => {
    if (activation === 'on_payment') return t('billingActivationOnPayment');
    if (activation === 'after_current') return t('billingActivationAfterCurrent');
    return t('billingActivationManual');
  };

  const describeLineEffect = (line: InvoiceLine): string => {
    let extra = '';
    if (line.kind === 'plan' && line.activation) {
      extra = ` (${activationLabel(line.activation)})`;
    } else if (line.kind === 'addon' && line.limit_key && line.limit_delta !== null) {
      const validityLabel =
        line.validity === 'fixed_days'
          ? `${t('billingValidityFixedDays')} ${line.validity_days ?? ''}`.trim()
          : t('billingValidityUntilPeriodEnd');
      extra = ` (+${line.limit_delta} ${limitKeyLabel(line.limit_key)}, ${validityLabel})`;
    }
    return `${kindLabel(line.kind)} · ${line.name} × ${line.quantity}${extra}`;
  };

  // Mark paid
  const openMarkPaid = async (invoice: Invoice) => {
    setMarkPaidLoading(true);
    setMarkPaidOpen(true);
    try {
      const res = await api.get(`/api/super-admin/billing/invoices/${invoice.id}`);
      setMarkPaidInvoice(res.data);
    } catch (error) {
      console.error('Failed to load invoice detail:', error);
      toast.error(t('failedToLoadData'));
      setMarkPaidOpen(false);
    } finally {
      setMarkPaidLoading(false);
    }
  };

  const confirmMarkPaid = async () => {
    if (!markPaidInvoice) return;
    setMarkPaidBusy(true);
    try {
      const res = await api.post(`/api/super-admin/billing/invoices/${markPaidInvoice.id}/mark-paid`, {});
      const effects = res.data?.effects || [];
      toast.success(t('billingInvoicePaidToast', { count: effects.length }));
      setMarkPaidOpen(false);
      setMarkPaidInvoice(null);
      reloadFirstPage(statusFilter);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('failedToLoadData'));
    } finally {
      setMarkPaidBusy(false);
    }
  };

  // Cancel
  const openCancel = (invoice: Invoice) => {
    setCancelInvoice(invoice);
    setCancelReason('');
    setCancelOpen(true);
  };

  const confirmCancel = async () => {
    if (!cancelInvoice) return;
    setCancelBusy(true);
    try {
      await api.post(`/api/super-admin/billing/invoices/${cancelInvoice.id}/cancel`, { reason: cancelReason });
      toast.success(t('billingInvoiceCancelledToast'));
      setCancelOpen(false);
      setCancelInvoice(null);
      reloadFirstPage(statusFilter);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('failedToLoadData'));
    } finally {
      setCancelBusy(false);
    }
  };

  // Create
  const openCreateDialog = () => {
    setCreateTenantId('');
    setQuantities({});
    setComment('');
    setShowCreateDialog(true);
  };

  const setQuantity = (itemId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [itemId]: Math.max(0, qty) }));
  };

  const runningTotal = catalog.reduce((sum, item) => sum + (quantities[item.id] || 0) * item.price, 0);

  const submitCreate = async () => {
    const lines = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([catalog_item_id, quantity]) => ({ catalog_item_id, quantity }));
    if (!createTenantId || lines.length === 0) {
      toast.error(t('fillRequiredFields'));
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/api/super-admin/billing/invoices', {
        tenant_id: createTenantId,
        lines,
        comment: comment.trim() || undefined,
      });
      toast.success(t('billingInvoiceCreated', { number: res.data?.number }));
      setShowCreateDialog(false);
      reloadFirstPage(statusFilter);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('billingSaveFailed'));
    } finally {
      setCreating(false);
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
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('billingInvoices')}</h1>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('billingInvoiceCreate')}
        </Button>
      </div>

      <div className="mb-6">
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | InvoiceStatus)}>
          <SelectTrigger className="w-[220px]" aria-label={t('status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {status === 'all' ? t('allStatuses') : statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('billingInvoiceNumber')}</TableHead>
            <TableHead>{t('organization')}</TableHead>
            <TableHead>{t('created')}</TableHead>
            <TableHead>{t('billingInvoiceAmount')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead>{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                {t('billingNoInvoicesFound')}
              </TableCell>
            </TableRow>
          ) : (
            invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">{invoice.number}</TableCell>
                <TableCell>{invoice.tenant_name}</TableCell>
                <TableCell>{new Date(invoice.issued_at).toLocaleDateString('ru-RU')}</TableCell>
                <TableCell>{formatRub(invoice.total)}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(invoice.status)}>{statusLabel(invoice.status)}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1.5">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/billing/invoices/${invoice.id}/print`} target="_blank" rel="noopener noreferrer">
                        {t('billingOpenPrint')}
                      </Link>
                    </Button>
                    {invoice.status === 'issued' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => openMarkPaid(invoice)}>
                          {t('billingMarkPaid')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openCancel(invoice)}>
                          {t('billingCancelInvoice')}
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {t('billingShowMore')}
          </Button>
        </div>
      )}

      {/* Create invoice dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('billingInvoiceCreate')}</DialogTitle>
            <DialogDescription>{t('billingInvoiceCreateDesc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>{t('organization')}</Label>
              <div className="mt-1">
                <TenantCombobox tenants={tenants} value={createTenantId} onChange={setCreateTenantId} />
              </div>
            </div>

            <div className="space-y-2">
              {catalog.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 border rounded-md p-2">
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-sm text-muted-foreground">{formatRub(item.price)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`qty-${item.id}`} className="sr-only">
                      {t('quantity')}
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuantity(item.id, (quantities[item.id] || 0) - 1)}
                    >
                      −
                    </Button>
                    <span id={`qty-${item.id}`} className="w-6 text-center">
                      {quantities[item.id] || 0}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuantity(item.id, (quantities[item.id] || 0) + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Label htmlFor="invoice-comment">{t('comment')}</Label>
              <Textarea id="invoice-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
            </div>

            <div className="flex items-center justify-between font-medium">
              <span>{t('billingInvoiceTotalLabel')}</span>
              <span>{formatRub(runningTotal)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={creating}>
              {t('cancel')}
            </Button>
            <Button onClick={submitCreate} disabled={creating}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark paid confirmation */}
      <ConfirmActionDialog
        open={markPaidOpen}
        onOpenChange={(open) => {
          if (!markPaidBusy) {
            setMarkPaidOpen(open);
            if (!open) setMarkPaidInvoice(null);
          }
        }}
        title={t('billingMarkPaidConfirmTitle')}
        description={
          markPaidLoading || !markPaidInvoice ? (
            t('loading')
          ) : (
            <div className="space-y-2">
              <p>{t('billingMarkPaidApplies')}</p>
              <ul className="list-disc pl-5 space-y-1">
                {(markPaidInvoice.lines || []).map((line) => (
                  <li key={line.id}>{describeLineEffect(line)}</li>
                ))}
              </ul>
            </div>
          )
        }
        confirmLabel={t('billingMarkPaid')}
        onConfirm={confirmMarkPaid}
        busy={markPaidBusy}
        confirmDisabled={markPaidLoading || !markPaidInvoice}
      />

      {/* Cancel confirmation */}
      <ConfirmActionDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!cancelBusy) {
            setCancelOpen(open);
            if (!open) setCancelInvoice(null);
          }
        }}
        title={t('billingCancelInvoice')}
        description={cancelInvoice ? cancelInvoice.number : ''}
        confirmLabel={t('billingCancelInvoice')}
        onConfirm={confirmCancel}
        busy={cancelBusy}
        destructive
        confirmDisabled={cancelReason.trim() === ''}
      >
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">{t('td_reasonRequiredLabel')}</Label>
          <Textarea
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={2}
          />
        </div>
      </ConfirmActionDialog>
    </div>
  );
}
