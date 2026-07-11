import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuspendTenantDialog } from '../SuspendTenantDialog';
import '../../i18n';

describe('SuspendTenantDialog', () => {
  it('keeps confirm disabled until BOTH the checkbox is checked AND the tenant name is typed', () => {
    render(
      <SuspendTenantDialog
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={() => {}}
        busy={false}
      />
    );
    const confirmButton = screen.getByRole('button', { name: /suspend/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmButton).toBeDisabled(); // checkbox alone is not enough

    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = vi.fn();
    render(
      <SuspendTenantDialog
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={onConfirm}
        busy={false}
      />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    const [reasonBox] = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(reasonBox, { target: { value: 'nonpayment' } });
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    expect(onConfirm).toHaveBeenCalledWith('nonpayment');
  });
});
