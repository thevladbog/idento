import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { includedVat } from '@/lib/vat';

type CatalogKind = 'plan' | 'service' | 'addon';

interface InvoiceLine {
  id: string;
  position: number;
  kind: CatalogKind;
  name: string;
  price: number;
  vat_rate: number | null;
  quantity: number;
  amount: number;
}

interface Invoice {
  id: string;
  number: string;
  status: string;
  issued_at: string;
  buyer_name: string;
  buyer_inn: string;
  buyer_kpp?: string | null;
  buyer_address: string;
  seller_name: string;
  seller_inn: string;
  seller_bank_name: string;
  seller_bank_account: string;
  seller_bank_bik: string;
  seller_bank_corr_account?: string | null;
  total: number;
  lines?: InvoiceLine[];
  total_in_words?: string;
}

// Print-only formatter: an RF счёт always shows kopecks (2 decimal places),
// which also keeps figures consistent with total_in_words (always emits
// kopecks, e.g. "...рублей 00 копеек"). Scoped to this print view — the
// list views elsewhere in this console intentionally keep whole-ruble
// display via their own local formatRub.
function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

export default function InvoicePrint() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  const loadInvoice = async () => {
    try {
      const res = await api.get(`/api/super-admin/billing/invoices/${id}`);
      setInvoice(res.data);
    } catch (error) {
      console.error('Failed to load invoice:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the data-loading routine synchronously raises its loading flag before the async fetch; the fetch-effect pattern is this console's established data layer (no query library here)
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the route id changes
  }, [id]);

  if (loading) {
    return <div className="p-8 text-black bg-white">{t('loading')}</div>;
  }

  if (!invoice) {
    return <div className="p-8 text-black bg-white">{t('tenantNotFound')}</div>;
  }

  const lines = invoice.lines || [];
  const dateStr = new Date(invoice.issued_at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const vatLines = lines.filter((l) => l.vat_rate !== null);
  const noVatLines = lines.filter((l) => l.vat_rate === null);
  const vatTotal = vatLines.reduce((sum, l) => sum + includedVat(l.amount, l.vat_rate as number), 0);
  const noVatTotal = noVatLines.reduce((sum, l) => sum + l.amount, 0);
  const hasVat = vatLines.length > 0;
  // Mixed invoice: some lines carry VAT, some don't. The pure cases (all
  // lines VAT / no lines VAT) are unchanged below; only the mixed case gets
  // a second totals row annotating the untaxed portion, since otherwise
  // nothing on the document marks which part of "Итого" is VAT-free.
  const isMixedVat = hasVat && noVatLines.length > 0;

  return (
    <div className="min-h-screen bg-white">
      <div className="print:hidden fixed top-4 right-4">
        <Button onClick={() => window.print()}>{t('billingPrint')}</Button>
      </div>

      <div className="max-w-[800px] mx-auto p-8 text-black bg-white">
        {/* Bank requisites header */}
        <div className="grid grid-cols-2 gap-4 border border-black p-2 text-xs mb-4">
          <div className="space-y-0.5">
            <div>Банк получателя: {invoice.seller_bank_name}</div>
            <div>БИК: {invoice.seller_bank_bik}</div>
            <div>к/с: {invoice.seller_bank_corr_account || '—'}</div>
          </div>
          <div className="space-y-0.5">
            <div>ИНН: {invoice.seller_inn}</div>
            <div className="font-semibold">Получатель: {invoice.seller_name}</div>
            <div>р/с: {invoice.seller_bank_account}</div>
          </div>
        </div>

        <h1 className="text-xl font-bold text-center my-6">
          Счёт на оплату № {invoice.number} от {dateStr}
        </h1>

        <div className="mb-4 text-sm">
          <div>
            <span className="font-semibold">Поставщик (Исполнитель):</span> {invoice.seller_name}, ИНН{' '}
            {invoice.seller_inn}
          </div>
          <div className="mt-1">
            <span className="font-semibold">Покупатель (Заказчик):</span> {invoice.buyer_name}, ИНН{' '}
            {invoice.buyer_inn}
            {invoice.buyer_kpp ? ` / КПП ${invoice.buyer_kpp}` : ''}, {invoice.buyer_address}
          </div>
        </div>

        <table className="w-full border-collapse text-sm mb-4">
          <thead>
            <tr>
              <th className="border border-black p-1 text-left">№</th>
              <th className="border border-black p-1 text-left">Наименование</th>
              <th className="border border-black p-1 text-right">Кол-во</th>
              <th className="border border-black p-1 text-right">Цена</th>
              <th className="border border-black p-1 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="border border-black p-1">{line.position}</td>
                <td className="border border-black p-1">{line.name}</td>
                <td className="border border-black p-1 text-right">{line.quantity}</td>
                <td className="border border-black p-1 text-right">{formatRub(line.price)}</td>
                <td className="border border-black p-1 text-right">{formatRub(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-right text-sm space-y-1 mb-4">
          <div>Итого: {formatRub(invoice.total)}</div>
          <div>{hasVat ? `В том числе НДС: ${formatRub(vatTotal)}` : 'Без НДС'}</div>
          {isMixedVat && <div>Без НДС: {formatRub(noVatTotal)}</div>}
          <div className="font-semibold">Всего к оплате: {formatRub(invoice.total)}</div>
        </div>

        <div className="text-sm mb-2">
          Всего наименований {lines.length}, на сумму {formatRub(invoice.total)}
        </div>
        <div className="text-sm font-bold mb-8">{invoice.total_in_words}</div>

        {/* Fixed neutral, not the theme's `text-muted-foreground`: this sheet
        pins `text-black bg-white` regardless of the active theme (it's a
        printable document, not themed UI chrome). `text-muted-foreground`
        resolves to a light color in dark mode, which would be invisible on
        this always-white sheet. */}
        <div className="text-xs text-neutral-600 mb-12">
          Оплата данного счёта означает согласие с условиями поставки услуг.
        </div>

        <div className="text-sm">Руководитель _____________</div>
      </div>
    </div>
  );
}
