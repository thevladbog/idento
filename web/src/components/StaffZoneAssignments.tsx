import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { UserPlus, UserMinus, AlertCircle, Users } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import type { StaffZoneAssignment } from '@/types';

interface StaffZoneAssignmentsProps {
  zoneId: string;
  zoneName: string;
}

interface User {
  id: string;
  email: string;
  full_name?: string;
  role: string;
}

export function StaffZoneAssignments({ zoneId, zoneName }: StaffZoneAssignmentsProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<StaffZoneAssignment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<Map<string, User>>(new Map());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when zoneId changes
  }, [zoneId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load all users from tenant
      const usersResponse = await api.get<User[]>('/api/users');
      setUsers(usersResponse.data);

      // Load existing assignments
      const assignmentsResponse = await api.get<StaffZoneAssignment[]>(`/api/zones/${zoneId}/staff`);
      const assignmentsList = assignmentsResponse.data;
      setAssignments(assignmentsList);

      // Create map of assigned users
      const assignedMap = new Map<string, User>();
      assignmentsList.forEach(assignment => {
        const user = usersResponse.data.find(u => u.id === assignment.user_id);
        if (user) {
          assignedMap.set(user.id, user);
        }
      });
      setAssignedUsers(assignedMap);
    } catch (error) {
      console.error('Failed to load staff assignments:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddStaff = async () => {
    if (!selectedUserId) return;

    try {
      setSaving(true);

      await api.post(`/api/zones/${zoneId}/staff`, {
        user_id: selectedUserId,
      });

      toast.success(t('staffAssigned'));

      setShowAddDialog(false);
      setSelectedUserId('');
      loadData();
    } catch (error) {
      console.error('Failed to assign staff:', error);
      toast.error(t('failedToAssignStaff'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveStaff = async (userId: string) => {
    try {
      setRemoving(userId);

      await api.delete(`/api/zones/${zoneId}/staff/${userId}`);

      toast.success(t('staffUnassigned'));

      loadData();
    } catch (error) {
      console.error('Failed to remove staff:', error);
      toast.error(t('failedToUnassignStaff'));
    } finally {
      setRemoving(null);
    }
  };

  const getAvailableUsers = () => {
    return users.filter(user => !assignedUsers.has(user.id));
  };

  const getUserDisplay = (user: User) => {
    return user.full_name || user.email;
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'manager':
        return 'bg-blue-100 text-blue-800';
      case 'staff':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          {t('loading')}
        </CardContent>
      </Card>
    );
  }

  const availableUsers = getAvailableUsers();

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('staffAssignments')}</CardTitle>
              <CardDescription>
                {t('assignStaffToZone', { zoneName })}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="gap-1">
                <Users className="h-3 w-3" />
                {assignments.length} {t('assigned')}
              </Badge>
              <Button onClick={() => setShowAddDialog(true)} disabled={availableUsers.length === 0}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t('assignStaff')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {assignments.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t('noStaffAssigned')}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                {Array.from(assignedUsers.values()).map(user => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{getUserDisplay(user)}</span>
                        <span className="text-sm text-muted-foreground">{user.email}</span>
                      </div>
                      <Badge variant="secondary" className={getRoleColor(user.role)}>
                        {t(user.role)}
                      </Badge>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveStaff(user.id)}
                      disabled={removing === user.id}
                    >
                      <UserMinus className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {availableUsers.length === 0 && assignments.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t('allStaffAssigned')}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Staff Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assignStaff')}</DialogTitle>
            <DialogDescription>
              {t('selectUserToAssign', { zoneName })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('user')}</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectUser')} />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <span>{getUserDisplay(user)}</span>
                        <Badge variant="secondary" className={getRoleColor(user.role)}>
                          {t(user.role)}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAddStaff} disabled={!selectedUserId || saving}>
              {saving ? t('assigning') : t('assign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

