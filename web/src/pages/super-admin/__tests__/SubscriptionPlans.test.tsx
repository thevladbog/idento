import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SubscriptionPlans from '../SubscriptionPlans';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const mockPlans = [
  {
    id: 'plan-1',
    name: 'Starter',
    slug: 'starter',
    tier: 'starter',
    description: '',
    price_monthly: 29,
    price_yearly: 290,
    limits: { events_per_month: 10, attendees_per_event: 100, users: 3 },
    features: { custom_branding: false, api_access: false, priority_support: false },
    is_active: true,
    is_public: true,
    sort_order: 0,
  },
];

describe('SubscriptionPlans Unlimited toggle', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPlans });
  });

  it('shows the limit as a plain number with Unlimited off by default', async () => {
    render(<SubscriptionPlans />);
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const eventsInput = screen.getByDisplayValue('10');
    expect(eventsInput).not.toBeDisabled();
  });

  it('setting Unlimited disables the number input and clears it to -1', async () => {
    render(<SubscriptionPlans />);
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const eventsInput = screen.getByDisplayValue('10');
    const unlimitedToggle = screen.getByLabelText(/events.*month.*unlimited/i);
    fireEvent.click(unlimitedToggle);
    expect(eventsInput).toBeDisabled();
    expect(eventsInput).toHaveValue(null);
  });

  it('a limit already at -1 initializes with Unlimited on and the input disabled', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ ...mockPlans[0], limits: { ...mockPlans[0].limits, events_per_month: -1 } }],
    });
    render(<SubscriptionPlans />);
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const unlimitedToggle = screen.getByLabelText(/events.*month.*unlimited/i);
    expect(unlimitedToggle).toHaveAttribute('data-state', 'checked');
    expect(screen.getByPlaceholderText(/unlimited/i)).toBeDisabled();
  });
});
