import { useEffect, useState } from 'react';
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
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  /** When set, the confirm button unlocks only after this exact text is typed. */
  confirmText?: string;
  destructive?: boolean;
  busy?: boolean;
};

export function ConfirmActionDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, confirmText, destructive, busy,
}: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  // Fail closed: an accidental empty-string confirmText must LOCK the confirm
  // button entirely, not silently bypass the typed gate.
  const requireText = confirmText !== undefined;
  const locked = requireText && (confirmText === '' || typed !== confirmText);

  const close = (o: boolean) => {
    setTyped('');
    onOpenChange(o);
  };

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {requireText && confirmText !== '' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: confirmText })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={locked || busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
