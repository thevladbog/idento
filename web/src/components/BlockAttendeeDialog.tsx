import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import api from '@/lib/api';
import type { Attendee } from '@/types';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';

interface BlockAttendeeDialogProps {
  attendee: Attendee;
  onUpdated: () => void;
}

export function BlockAttendeeDialog({ attendee, onUpdated }: BlockAttendeeDialogProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [reason, setReason] = useState('');

  const handleBlock = async () => {
    if (!reason.trim()) {
      toast.error(t('blockReasonRequired'));
      return;
    }

    setIsBlocking(true);
    try {
      await api.post(`/api/attendees/${attendee.id}/block`, { reason });
      setIsOpen(false);
      setReason('');
      onUpdated();
    } catch (error) {
      console.error('Failed to block attendee', error);
      toast.error(t('failedToBlockAttendee'));
    } finally {
      setIsBlocking(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t('block')}>
          <Ban className="h-4 w-4 text-yellow-600" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('blockAttendee')}</DialogTitle>
          <DialogDescription>
            {t('blockAttendeeDesc')}: {attendee.first_name} {attendee.last_name}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div>
            <Label htmlFor="reason">{t('blockReason')}</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('blockReasonPlaceholder')}
              autoFocus
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('blockReasonHint')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" onClick={handleBlock} disabled={isBlocking || !reason.trim()}>
            {isBlocking ? t('blocking') : t('blockAttendee')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

