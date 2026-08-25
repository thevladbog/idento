import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BillingCatalog from '../BillingCatalog';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const mockItems = [
  {
    id: 'item-plan',
    kind: 'plan',
    name: 'Pro Monthly',
    description: '',
    price: 2990,
    vat_rate: 20,
    is_public: true,
    is_active: true,
    sort_order: 0,
    plan_id: 'plan-1',
    period: 'month',
    default_activation: 'on_payment',
    limit_key: null,
    limit_delta: null,
    validity: null,
    validity_days: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'item-service',
    kind: 'service',
    name: 'Onboarding',
    description: 'Hands-on onboarding session',
    price: 5000,
    vat_rate: null,
    is_public: true,
    is_active: true,
    sort_order: 1,
    plan_id: null,
    period: null,
    default_activation: null,
    limit_key: null,
    limit_delta: null,
    validity: null,
    validity_days: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'item-addon',
    kind: 'addon',
    name: 'Extra seats',
    description: '',
    price: 500,
    vat_rate: 10,
    is_public: false,
    is_active: true,
    sort_order: 2,
    plan_id: null,
    period: null,
    default_activation: null,
    limit_key: 'users',
    limit_delta: 5,
    validity: 'until_period_end',
    validity_days: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const mockPlans = [{ id: 'plan-1', name: 'Pro' }];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/billing/catalog')) return Promise.resolve({ data: mockItems });
    if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
    return Promise.reject(new Error('unexpected url ' + url));
  });
}

describe('BillingCatalog', () => {
  beforeEach(() => {
    mockApiGet();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('renders the catalog items with kind badges and a no-VAT indicator', async () => {
    render(<BillingCatalog />);
    await waitFor(() => expect(screen.getByText('Pro Monthly')).toBeInTheDocument());
    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Extra seats')).toBeInTheDocument();

    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Add-on')).toBeInTheDocument();

    expect(screen.getByText('No VAT')).toBeInTheDocument();
  });

  it('shows the addon-specific limit fields once kind=Add-on is picked in the dialog', async () => {
    render(<BillingCatalog />);
    await waitFor(() => expect(screen.getByText('Pro Monthly')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.queryByRole('combobox', { name: 'Limit' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    const kindListbox = await screen.findByRole('listbox');
    fireEvent.click(within(kindListbox).getByText('Add-on'));

    expect(screen.getByRole('combobox', { name: 'Limit' })).toBeInTheDocument();
    expect(screen.getByLabelText('Limit delta')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Validity' })).toBeInTheDocument();
  });

  it('submits a new item with vat_rate null when No VAT is selected', async () => {
    render(<BillingCatalog />);
    await waitFor(() => expect(screen.getByText('Pro Monthly')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Badge reprint' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '150' } });

    fireEvent.click(screen.getByRole('combobox', { name: 'VAT' }));
    const vatListbox = await screen.findByRole('listbox');
    fireEvent.click(within(vatListbox).getByText('No VAT'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toContain('/billing/catalog');
    expect(body).toMatchObject({
      kind: 'service',
      name: 'Badge reprint',
      price: 150,
      vat_rate: null,
    });
  });
});
