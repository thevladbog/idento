import { useState, useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import type { User } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from '@/components/ui/label';

interface AssignStaffDialogProps {
  eventId: string;
  onAssigned: () => void;
  children?: React.ReactNode;
}

export function AssignStaffDialog({ eventId, onAssigned, children }: AssignStaffDialogProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadUsers();
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await api.get<User[]>('/api/users');
      // Filter only staff
      const staffUsers = (response.data || []).filter(u => u.role === 'staff');
      setAllUsers(staffUsers);
    } catch (error) {
      console.error('Failed to load users', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedUserId) return;

    setIsAssigning(true);
    try {
      await api.post(`/api/events/${eventId}/staff`, {
        user_id: selectedUserId,
      });
      setIsOpen(false);
      setSelectedUserId('');
      onAssigned();
    } catch (error) {
      console.error('Failed to assign staff', error);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            <UserPlus className="mr-2 h-4 w-4" /> {t('assignStaff')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assignStaffToEvent')}</DialogTitle>
          <DialogDescription>
            {t('assignStaffToEventDesc')}
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="py-4 text-center text-muted-foreground">{t('loading')}</div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('selectStaff')}</Label>
              <div className="col-span-3">
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectStaffMember')} />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleAssign} disabled={!selectedUserId || isAssigning}>
            {isAssigning ? t('assigning') : t('assign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

