import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArchiveSheet } from '../ArchiveSheet';
import '../../i18n';

describe('ArchiveSheet', () => {
  it('keeps confirm disabled until both checkboxes are checked and the tenant name is typed', () => {
    render(
      <ArchiveSheet
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={() => {}}
        busy={false}
      />
    );
    const confirmButton = screen.getByRole('button', { name: /archive/i });
    expect(confirmButton).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(confirmButton).toBeDisabled(); // only one of two acknowledgments

    fireEvent.click(checkboxes[1]);
    expect(confirmButton).toBeDisabled(); // both checked, but name not typed yet

    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = vi.fn();
    render(
      <ArchiveSheet
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={onConfirm}
        busy={false}
      />
    );
    screen.getAllByRole('checkbox').forEach((cb) => fireEvent.click(cb));
    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    const [reasonBox] = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(reasonBox, { target: { value: 'contract ended' } });
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(onConfirm).toHaveBeenCalledWith('contract ended');
  });
});
