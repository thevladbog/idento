import { useState } from 'react';

/**
 * Typed-confirm gating logic shared by LifecycleActionDialog and
 * ArchiveSheet. Mirrors ConfirmActionDialog's fail-closed semantics
 * (extracted, not imported — ConfirmActionDialog itself is never modified):
 * an empty-string confirmText LOCKS the gate rather than bypassing it.
 */
export function useTypedConfirmGate(open: boolean, confirmText: string | undefined) {
  const [typed, setTyped] = useState('');
  // Adjust-state-during-render reset on (re)open -- see
  // ConfirmActionDialog.tsx for the rationale.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTyped('');
  }
  const requireText = confirmText !== undefined;
  const locked = requireText && (confirmText === '' || typed !== confirmText);

  return { typed, setTyped, locked, requireText };
}
