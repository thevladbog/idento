import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  /** When set, the confirm button unlocks only after this exact text is typed. */
  confirmText?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Extra content rendered between the description and the footer (e.g. a required-reason textarea). */
  children?: React.ReactNode;
  /** External gate ORed with the confirmText lock -- e.g. a required reason left empty. */
  confirmDisabled?: boolean;
};

export function ConfirmActionDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, confirmText, destructive, busy, children, confirmDisabled,
}: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  // Reset the typed gate whenever the dialog (re)opens -- the canonical
  // adjust-state-during-render pattern (React "You Might Not Need an
  // Effect"), replacing the previous reset effect: no extra commit with a
  // stale typed value.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTyped('');
  }
  // Fail closed: an accidental empty-string confirmText must LOCK the confirm
  // button entirely, not silently bypass the typed gate.
  const requireText = confirmText !== undefined;
  const locked = (requireText && (confirmText === '' || typed !== confirmText)) || !!confirmDisabled;

  const close = (o: boolean) => {
    // While the confirmed action is in flight, every dismissal path
    // (Cancel, Escape, outside click, the X button) is inert -- closing
    // would detach the busy state from the only surface reporting it while
    // the mutation still lands (or fails) invisibly.
    if (!o && busy) return;
    setTyped('');
    onOpenChange(o);
  };


  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* asChild + div: description can be rich content (lists, etc.), and
              Radix's Description renders a <p> by default, which cannot
              legally contain block-level children. */}
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        {requireText && confirmText !== '' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: confirmText })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} />
          </div>
        )}
        {children}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => close(false)}>{t('cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={locked || busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
