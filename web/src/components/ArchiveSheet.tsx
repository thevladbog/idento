import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
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

export function ArchiveSheet({ open, onOpenChange, tenantName, usersCount, eventsCount, onConfirm, busy }: Props) {
  const { t } = useTranslation();
  const { typed, setTyped, locked } = useTypedConfirmGate(open, tenantName);
  const [ackRetention, setAckRetention] = useState(false);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [reason, setReason] = useState('');

  const close = (o: boolean) => {
    if (!o) {
      setAckRetention(false);
      setAckIrreversible(false);
      setReason('');
    }
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('td_archive_title')}</SheetTitle>
          <SheetDescription>
            {t('td_archive_consequence', { tenant: tenantName, users: usersCount, events: eventsCount })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox id="archive-ack-retention" checked={ackRetention} onCheckedChange={(v) => setAckRetention(v === true)} />
            <Label htmlFor="archive-ack-retention" className="text-sm font-normal leading-snug">
              {t('td_archive_acknowledgeRetention')}
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="archive-ack-irreversible" checked={ackIrreversible} onCheckedChange={(v) => setAckIrreversible(v === true)} />
            <Label htmlFor="archive-ack-irreversible" className="text-sm font-normal leading-snug">
              {t('td_archive_acknowledgeIrreversible')}
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="archive-reason">{t('td_reasonOptionalLabel')}</Label>
          <Textarea id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: tenantName })}</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tenantName} />
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button
            variant="destructive"
            disabled={locked || !ackRetention || !ackIrreversible || busy}
            onClick={() => onConfirm(reason)}
          >
            {t('lifecycle_archive_confirm')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
