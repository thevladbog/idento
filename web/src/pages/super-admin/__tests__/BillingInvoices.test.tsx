import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BillingInvoices from '../BillingInvoices';
import api from '@/lib/api';
import { toast } from 'sonner';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockInvoices = [
  {
    id: 'inv-1',
    number: 'СЧ-2026-0007',
    tenant_id: 't1',
    tenant_name: 'Acme Corp',
    status: 'issued',
    issued_at: '2026-08-01T00:00:00Z',
    total: 3588,
    buyer_name: 'Acme LLC',
    buyer_inn: '7700000000',
    buyer_address: 'Moscow',
    seller_name: 'Idento LLC',
    seller_inn: '9990000000',
    seller_bank_name: 'Test Bank',
    seller_bank_account: '40702810000000000000',
    seller_bank_bik: '044525225',
  },
  {
    id: 'inv-2',
    number: 'СЧ-2026-0003',
    tenant_id: 't2',
    tenant_name: 'Beta Inc',
    status: 'paid',
    issued_at: '2026-07-01T00:00:00Z',
    total: 1000,
    buyer_name: 'Beta LLC',
    buyer_inn: '7700000001',
    buyer_address: 'Spb',
    seller_name: 'Idento LLC',
    seller_inn: '9990000000',
    seller_bank_name: 'Test Bank',
    seller_bank_account: '40702810000000000000',
    seller_bank_bik: '044525225',
  },
];

const mockInvoiceDetail = {
  ...mockInvoices[0],
  lines: [
    {
      id: 'l1',
      position: 1,
      catalog_item_id: 'item-plan',
      kind: 'plan',
      name: 'Pro Monthly',
      price: 2990,
      vat_rate: 20,
      activation: 'on_payment',
      limit_key: null,
      limit_delta: null,
      validity: null,
      validity_days: null,
      quantity: 1,
      amount: 2990,
    },
    {
      id: 'l2',
      position: 2,
      catalog_item_id: 'item-addon',
      kind: 'addon',
      name: 'Extra seats',
      price: 598,
      vat_rate: 10,
      activation: null,
      limit_key: 'users',
      limit_delta: 5,
      validity: 'until_period_end',
      validity_days: null,
      quantity: 1,
      amount: 598,
    },
  ],
  total_in_words: 'Три тысячи пятьсот восемьдесят восемь рублей 00 копеек',
};

const mockTenants = [
  { tenant: { id: 't1', name: 'Acme Corp' } },
  { tenant: { id: 't2', name: 'Beta Inc' } },
];

const mockCatalog = [
  { id: 'item-service', kind: 'service', name: 'Onboarding', price: 500, vat_rate: null },
];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/billing/invoices/inv-1')) return Promise.resolve({ data: mockInvoiceDetail });
    if (url.includes('/billing/invoices')) return Promise.resolve({ data: mockInvoices });
    if (url.includes('/billing/catalog')) return Promise.resolve({ data: mockCatalog });
    if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
    return Promise.reject(new Error('unexpected url ' + url));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BillingInvoices />
    </MemoryRouter>
  );
}

describe('BillingInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('renders the invoice list with numbers, tenant names, and status badges', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('СЧ-2026-0007')).toBeInTheDocument());
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('СЧ-2026-0003')).toBeInTheDocument();
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('mark-paid flow fetches the invoice detail, posts mark-paid, and shows a success toast', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('СЧ-2026-0007')).toBeInTheDocument());

    const row = screen.getByText('СЧ-2026-0007').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mark paid' }));

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/billing/invoices/inv-1')));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Confirm invoice payment')).toBeInTheDocument();
    expect(within(dialog).getByText(/Pro Monthly/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Extra seats/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark paid' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/mark-paid'), expect.anything()));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('surfaces the server error text in a toast when mark-paid fails with 409', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 409, data: { error: 'addon requires the subscription to have an end date' } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('СЧ-2026-0007')).toBeInTheDocument());

    const row = screen.getByText('СЧ-2026-0007').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mark paid' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark paid' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('addon requires the subscription to have an end date')
    );
  });
});
