import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTypedConfirmGate } from '@/hooks/useTypedConfirmGate';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantName: string;
  usersCount: number;
  eventsCount: number;
  onConfirm: (reason: string) => void | Promise<void>;
  busy: boolean;
};

export function SuspendTenantDialog({ open, onOpenChange, tenantName, usersCount, eventsCount, onConfirm, busy }: Props) {
  const { t } = useTranslation();
  const { typed, setTyped, locked } = useTypedConfirmGate(open, tenantName);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');

  const close = (o: boolean) => {
    if (!o) {
      setAcknowledged(false);
      setReason('');
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('td_suspend_title')}</DialogTitle>
          <DialogDescription>
            {t('td_suspend_consequence', { tenant: tenantName, users: usersCount, events: eventsCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2">
          <Checkbox id="suspend-ack" checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
          <Label htmlFor="suspend-ack" className="text-sm font-normal leading-snug">
            {t('td_suspend_acknowledge')}
          </Label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="suspend-reason">{t('td_reasonOptionalLabel')}</Label>
          <Textarea id="suspend-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: tenantName })}</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tenantName} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button variant="destructive" disabled={locked || !acknowledged || busy} onClick={() => onConfirm(reason)}>
            {t('lifecycle_suspend_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
