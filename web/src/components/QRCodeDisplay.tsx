import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { Attendee } from '@/types';

interface QRCodeDisplayProps {
  attendee: Attendee;
}

export function QRCodeDisplay({ attendee }: QRCodeDisplayProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  
  // Construct QR image URL
  const qrImageUrl = `http://localhost:8008/api/attendees/${attendee.id}/qr`;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t('viewQRCode')}>
          <QrCode className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('qrCode')}</DialogTitle>
          <DialogDescription>
            {attendee.first_name} {attendee.last_name} - {attendee.code}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-4">
          <img 
            src={qrImageUrl} 
            alt={t('qrCodeFor', { code: attendee.code })}
            className="w-64 h-64 border rounded"
            onError={(e) => {
              console.error('Failed to load QR code');
              e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            }}
          />
        </div>
        <div className="text-center text-sm text-muted-foreground">
          {t('code')}: <span className="font-mono font-bold">{attendee.code}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

