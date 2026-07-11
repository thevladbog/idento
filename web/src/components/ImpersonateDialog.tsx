import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantName: string;
  onConfirm: (reason: string) => void | Promise<void>;
  busy: boolean;
};

export function ImpersonateDialog({ open, onOpenChange, tenantName, onConfirm, busy }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  const close = (o: boolean) => {
    if (!o) setReason('');
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('impersonateTitle')}</DialogTitle>
          <DialogDescription>{t('impersonateDescription', { tenant: tenantName })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="impersonate-reason">{t('td_reasonRequiredLabel')}</Label>
          <Textarea
            id="impersonate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('td_impersonateReasonPlaceholder')}
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button disabled={reason.trim() === '' || busy} onClick={() => onConfirm(reason)}>
            {t('impersonateConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
