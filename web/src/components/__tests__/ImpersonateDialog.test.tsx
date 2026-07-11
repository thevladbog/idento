import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImpersonateDialog } from '../ImpersonateDialog';
import '../../i18n';

describe('ImpersonateDialog', () => {
  it('keeps confirm disabled until a reason is typed', () => {
    render(<ImpersonateDialog open onOpenChange={() => {}} tenantName="Acme Corp" onConfirm={() => {}} busy={false} />);
    const confirmButton = screen.getByRole('button', { name: /start session/i });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'customer requested help debugging check-in' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = vi.fn();
    render(<ImpersonateDialog open onOpenChange={() => {}} tenantName="Acme Corp" onConfirm={onConfirm} busy={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'support ticket #42' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    expect(onConfirm).toHaveBeenCalledWith('support ticket #42');
  });
});
