import { useState, useEffect } from 'react';
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
import { Edit } from 'lucide-react';
import { toast } from 'sonner';

interface EditAttendeeDialogProps {
  attendee: Attendee;
  fieldSchema?: string[]; // Available fields from CSV
  onUpdated: () => void;
}

export function EditAttendeeDialog({ attendee, fieldSchema, onUpdated }: EditAttendeeDialogProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Standard fields that have dedicated columns
  const standardFields = ['first_name', 'last_name', 'email', 'company', 'position', 'code'];

  // Get custom fields (all fields from schema except standard ones)
  const customFields = fieldSchema
    ? fieldSchema.filter(field => !standardFields.includes(field.toLowerCase()))
    : [];

  useEffect(() => {
    if (isOpen) {
      // Initialize with standard fields
      const initialData: Record<string, string> = {
        first_name: attendee.first_name,
        last_name: attendee.last_name,
        email: attendee.email,
        company: attendee.company || '',
        position: attendee.position || '',
        code: attendee.code
      };

      // Add custom fields from attendee.custom_fields
      if (attendee.custom_fields) {
        Object.keys(attendee.custom_fields).forEach(key => {
          if (!standardFields.includes(key.toLowerCase())) {
            initialData[key] = String(attendee.custom_fields![key] || '');
          }
        });
      }

      setFormData(initialData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init when isOpen/attendee/fieldSchema change
  }, [isOpen, attendee, fieldSchema]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Separate standard fields and custom fields
      const updateData: {
        first_name: string;
        last_name: string;
        email: string;
        company: string;
        position: string;
        code: string;
        custom_fields: Record<string, string>;
      } = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        company: formData.company,
        position: formData.position,
        code: formData.code,
        custom_fields: {}
      };

      // Add custom fields
      Object.keys(formData).forEach(key => {
        if (!standardFields.includes(key.toLowerCase())) {
          updateData.custom_fields[key] = formData[key];
        }
      });

      await api.patch(`/api/attendees/${attendee.id}`, updateData);
      setIsOpen(false);
      onUpdated();
    } catch (error) {
      console.error('Failed to update attendee', error);
      toast.error(t('failedToUpdateAttendee'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t('edit')}>
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editAttendee')}</DialogTitle>
          <DialogDescription>{t('editAttendeeDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
          {/* Standard Fields */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-muted-foreground">{t('standardFields')}</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="first_name">{t('firstName')}</Label>
                <Input
                  id="first_name"
                  value={formData.first_name || ''}
                  onChange={(e) => updateField('first_name', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="last_name">{t('lastName')}</Label>
                <Input
                  id="last_name"
                  value={formData.last_name || ''}
                  onChange={(e) => updateField('last_name', e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => updateField('email', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="company">{t('company')}</Label>
                <Input
                  id="company"
                  value={formData.company || ''}
                  onChange={(e) => updateField('company', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="position">{t('position')}</Label>
                <Input
                  id="position"
                  value={formData.position || ''}
                  onChange={(e) => updateField('position', e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="code">{t('code')}</Label>
              <Input
                id="code"
                value={formData.code || ''}
                onChange={(e) => updateField('code', e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <h4 className="font-semibold text-sm text-muted-foreground">{t('additionalFields')}</h4>
              <div className="grid gap-4">
                {customFields.map((field) => (
                  <div key={field}>
                    <Label htmlFor={field} className="capitalize">
                      {field.replace(/_/g, ' ')}
                    </Label>
                    <Input
                      id={field}
                      value={formData[field] || ''}
                      onChange={(e) => updateField(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

