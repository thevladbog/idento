import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmActionDialog } from '../ConfirmActionDialog';
import '../../i18n';

function renderDialog(busy: boolean) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmActionDialog
      open
      onOpenChange={onOpenChange}
      title="Suspend tenant"
      description="This pauses the tenant."
      confirmLabel="Suspend"
      onConfirm={onConfirm}
      busy={busy}
    />
  );
  return { onOpenChange, onConfirm };
}

// Backlog item "ConfirmActionDialog allows Cancel/ESC mid-busy": dismissing
// the dialog while the mutation is in flight detaches the busy state from
// the only surface reporting it — the action still completes (or fails)
// invisibly. While busy, every dismissal path must be inert.
describe('ConfirmActionDialog busy gating', () => {
  it('ignores Cancel, Escape, and the X close while busy', () => {
    const { onOpenChange } = renderDialog(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const closeX = screen.queryByRole('button', { name: /close/i });
    if (closeX) fireEvent.click(closeX);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('still dismisses normally when not busy', () => {
    const { onOpenChange } = renderDialog(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
