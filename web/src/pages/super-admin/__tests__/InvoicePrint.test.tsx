import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import InvoicePrint from '../InvoicePrint';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

const mockInvoice = {
  id: 'inv-1',
  number: 'СЧ-2026-0007',
  tenant_id: 't1',
  status: 'issued',
  issued_at: '2026-08-25T00:00:00Z',
  buyer_name: 'Acme LLC',
  buyer_inn: '7700000000',
  buyer_kpp: '770001001',
  buyer_address: 'Moscow, Test str 1',
  seller_name: 'Idento LLC',
  seller_inn: '9990000000',
  seller_bank_name: 'Test Bank',
  seller_bank_account: '40702810000000000000',
  seller_bank_bik: '044525225',
  seller_bank_corr_account: '30101810000000000000',
  total: 220,
  lines: [
    {
      id: 'l1',
      position: 1,
      catalog_item_id: 'item-1',
      kind: 'service',
      name: 'Badge printing',
      price: 120,
      vat_rate: 20,
      activation: null,
      limit_key: null,
      limit_delta: null,
      validity: null,
      validity_days: null,
      quantity: 1,
      amount: 120,
    },
    {
      id: 'l2',
      position: 2,
      catalog_item_id: 'item-2',
      kind: 'service',
      name: 'Onboarding',
      price: 100,
      vat_rate: null,
      activation: null,
      limit_key: null,
      limit_delta: null,
      validity: null,
      validity_days: null,
      quantity: 1,
      amount: 100,
    },
  ],
  total_in_words: 'Двести двадцать рублей 00 копеек',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/super-admin/billing/invoices/inv-1/print']}>
      <Routes>
        <Route path="/super-admin/billing/invoices/:id/print" element={<InvoicePrint />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('InvoicePrint', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/billing/invoices/inv-1')) return Promise.resolve({ data: mockInvoice });
      return Promise.reject(new Error('unexpected url ' + url));
    });
  });

  it('renders the RF payment document with the VAT total, total in words, and no nav chrome', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Счёт на оплату № СЧ-2026-0007/)).toBeInTheDocument());
    // 2 decimal places everywhere (M5) -- a счёт always shows kopecks, and
    // this keeps figures consistent with total_in_words which always emits
    // kopecks ("...рублей 00 копеек").
    expect(screen.getByText(/В том числе НДС: 20,00 ₽/)).toBeInTheDocument();
    expect(screen.getByText('Двести двадцать рублей 00 копеек')).toBeInTheDocument();
    expect(document.querySelector('nav')).not.toBeInTheDocument();
  });

  it('shows a distinct "Без НДС" totals row for a mixed invoice (some lines taxed, some not) without touching the "В том числе НДС" row', async () => {
    // mockInvoice already mixes a VAT line (l1, vat_rate 20) with a
    // non-VAT line (l2, vat_rate null, amount 100) -- exercise both rows.
    renderPage();

    await waitFor(() => expect(screen.getByText(/Счёт на оплату № СЧ-2026-0007/)).toBeInTheDocument());
    expect(screen.getByText('В том числе НДС: 20,00 ₽')).toBeInTheDocument();
    expect(screen.getByText('Без НДС: 100,00 ₽')).toBeInTheDocument();
  });

  it('keeps the pure no-VAT case as a plain "Без НДС" label with no amount row', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/billing/invoices/inv-1')) {
        return Promise.resolve({
          data: {
            ...mockInvoice,
            total: 100,
            lines: [{ ...mockInvoice.lines[1], amount: 100 }],
            total_in_words: 'Сто рублей 00 копеек',
          },
        });
      }
      return Promise.reject(new Error('unexpected url ' + url));
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(/Счёт на оплату № СЧ-2026-0007/)).toBeInTheDocument());
    expect(screen.getByText('Без НДС')).toBeInTheDocument();
    expect(screen.queryByText(/В том числе НДС/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Без НДС:/)).not.toBeInTheDocument();
  });

  it('does not append a duplicate "г." to the document date', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Счёт на оплату № СЧ-2026-0007/)).toBeInTheDocument());
    const heading = screen.getByText(/Счёт на оплату/);
    expect(heading.textContent).not.toMatch(/г\.\s*г\./);
    expect(heading.textContent).toMatch(/г\.$/);
  });
});
