import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AssignStaffDialog } from '@/components/AssignStaffDialog';
import api from '@/lib/api';
import type { User } from '@/types';
import { UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

export default function EventStaff() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const [staff, setStaff] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (eventId) {
      loadStaff();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const loadStaff = async () => {
    try {
      const response = await api.get<User[]>(`/api/events/${eventId}/staff`);
      setStaff(response.data || []);
    } catch (error) {
      console.error('Failed to load staff', error);
      setStaff([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveStaff = async (userId: string) => {
    if (!confirm(t('confirmRemoveStaff'))) return;

    try {
      await api.delete(`/api/events/${eventId}/staff/${userId}`);
      loadStaff();
    } catch (error) {
      console.error('Failed to remove staff', error);
      toast.error(t('failedToRemoveStaff'));
    }
  };

  if (loading) {
    return <div className="text-center text-muted-foreground">{t('loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('eventStaff')}</h2>
          <p className="text-muted-foreground">{t('eventStaffDesc')}</p>
        </div>
        <AssignStaffDialog eventId={eventId!} onAssigned={loadStaff}>
          <Button>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('assignStaff')}
          </Button>
        </AssignStaffDialog>
      </div>

      {staff.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">{t('noStaffAssigned')}</p>
            <AssignStaffDialog eventId={eventId!} onAssigned={loadStaff}>
              <Button variant="outline">
                <UserPlus className="mr-2 h-4 w-4" />
                {t('assignStaff')}
              </Button>
            </AssignStaffDialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {staff.map((user) => (
            <Card key={user.id}>
              <CardHeader>
                <CardTitle className="text-lg">{user.email}</CardTitle>
                <CardDescription>
                  <span className="inline-block px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
                    {user.role === 'manager' ? t('roleManager') : t('roleStaff')}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRemoveStaff(user.id)}
                  className="w-full"
                >
                  <UserMinus className="mr-2 h-4 w-4" />
                  {t('removeAccess')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

