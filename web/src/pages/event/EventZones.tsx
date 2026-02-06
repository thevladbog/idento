import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Edit, Trash2, QrCode as QrCodeIcon, TrendingUp, Users as UsersIcon, ShieldCheck, Settings, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { toast } from 'sonner';
import { ZoneAccessRules } from '@/components/ZoneAccessRules';
import { StaffZoneAssignments } from '@/components/StaffZoneAssignments';
import type { EventZoneWithStats, EventZone } from '@/types';

export default function EventZones() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const [zones, setZones] = useState<EventZoneWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [showAccessRulesDialog, setShowAccessRulesDialog] = useState(false);
  const [showStaffDialog, setShowStaffDialog] = useState(false);
  const [selectedZone, setSelectedZone] = useState<EventZone | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    zone_type: 'general',
    order_index: 0,
    open_time: '',
    close_time: '',
    is_registration_zone: false,
    requires_registration: true,
    is_active: true,
  });

  useEffect(() => {
    if (eventId) {
      loadZones();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const loadZones = async () => {
    try {
      setLoading(true);
      const response = await api.get<EventZoneWithStats[]>(
        `/api/events/${eventId}/zones?with_stats=true`
      );
      setZones(response.data || []);
    } catch (error) {
      console.error('Failed to load zones', error);
      toast.error(t('failedToLoadData'));
      setZones([]); // Reset to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post(`/api/events/${eventId}/zones`, formData);
      toast.success(t('zoneCreated'));
      setShowCreateDialog(false);
      resetForm();
      loadZones();
    } catch (error) {
      console.error('Failed to create zone', error);
      toast.error(t('failedToCreateZone'));
    }
  };

  const handleEdit = async () => {
    if (!selectedZone) return;

    try {
      await api.put(`/api/zones/${selectedZone.id}`, formData);
      toast.success(t('zoneUpdated'));
      setShowEditDialog(false);
      setSelectedZone(null);
      resetForm();
      loadZones();
    } catch (error) {
      console.error('Failed to update zone', error);
      toast.error(t('failedToUpdateZone'));
    }
  };

  const handleDelete = async () => {
    if (!selectedZone) return;

    try {
      await api.delete(`/api/zones/${selectedZone.id}`);
      toast.success(t('zoneDeleted'));
      setShowDeleteDialog(false);
      setSelectedZone(null);
      loadZones();
    } catch (error) {
      console.error('Failed to delete zone', error);
      toast.error(t('failedToDeleteZone'));
    }
  };

  const openCreateDialog = () => {
    resetForm();
    setFormData(prev => ({ ...prev, order_index: zones.length }));
    setShowCreateDialog(true);
  };

  const openEditDialog = (zone: EventZone) => {
    setSelectedZone(zone);
    setFormData({
      name: zone.name,
      zone_type: zone.zone_type,
      order_index: zone.order_index,
      open_time: zone.open_time || '',
      close_time: zone.close_time || '',
      is_registration_zone: zone.is_registration_zone,
      requires_registration: zone.requires_registration,
      is_active: zone.is_active,
    });
    setShowEditDialog(true);
  };

  const openDeleteDialog = (zone: EventZone) => {
    setSelectedZone(zone);
    setShowDeleteDialog(true);
  };

  const openQRDialog = (zone: EventZone) => {
    setSelectedZone(zone);
    setShowQRDialog(true);
  };

  const openAccessRulesDialog = (zone: EventZone) => {
    setSelectedZone(zone);
    setShowAccessRulesDialog(true);
  };

  const openStaffDialog = (zone: EventZone) => {
    setSelectedZone(zone);
    setShowStaffDialog(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      zone_type: 'general',
      order_index: 0,
      open_time: '',
      close_time: '',
      is_registration_zone: false,
      requires_registration: true,
      is_active: true,
    });
  };

  const downloadQR = () => {
    if (!selectedZone) return;
    const link = document.createElement('a');
    link.href = `${api.defaults.baseURL}/api/zones/${selectedZone.id}/qr`;
    link.download = `zone-${selectedZone.name}-qr.png`;
    link.click();
  };

  const getZoneTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      general: t('zoneTypeGeneral'),
      registration: t('zoneTypeRegistration'),
      vip: t('zoneTypeVIP'),
      workshop: t('zoneTypeWorkshop'),
      speaker: t('zoneTypeSpeaker'),
    };
    return types[type] || type;
  };

  const getZoneTypeBadgeVariant = (type: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      registration: 'default',
      vip: 'destructive',
      workshop: 'secondary',
      speaker: 'outline',
      general: 'outline',
    };
    return variants[type] || 'outline';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('zones')}</h2>
          <p className="text-muted-foreground">{t('zoneSettings')}</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('createZone')}
        </Button>
      </div>

      {zones.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t('noZonesYet')}</p>
            <Button onClick={openCreateDialog} className="mt-4">
              <Plus className="mr-2 h-4 w-4" />
              {t('createZone')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {zones.map((zoneWithStats) => {
            const zone = zoneWithStats.zone;
            return (
              <Card key={zone.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        {zone.name}
                        {!zone.is_active && (
                          <Badge variant="outline">{t('inactive')}</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        <Badge variant={getZoneTypeBadgeVariant(zone.zone_type)} className="mt-1">
                          {getZoneTypeLabel(zone.zone_type)}
                        </Badge>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* Statistics */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span>{zoneWithStats.total_checkins} {t('totalCheckins')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UsersIcon className="h-4 w-4 text-muted-foreground" />
                        <span>{zoneWithStats.today_checkins} {t('todayCheckins')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        <span>{zoneWithStats.access_rules_count} {t('accessRules')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UsersIcon className="h-4 w-4 text-muted-foreground" />
                        <span>{zoneWithStats.assigned_staff} {t('staff')}</span>
                      </div>
                    </div>

                    {/* Time constraints */}
                    {(zone.open_time || zone.close_time) && (
                      <div className="text-sm text-muted-foreground">
                        {zone.open_time && <span>{t('openTime')}: {zone.open_time}</span>}
                        {zone.open_time && zone.close_time && <span> - </span>}
                        {zone.close_time && <span>{t('closeTime')}: {zone.close_time}</span>}
                      </div>
                    )}

                    {/* Flags */}
                    <div className="flex flex-wrap gap-2">
                      {zone.is_registration_zone && (
                        <Badge variant="secondary">{t('isRegistrationZone')}</Badge>
                      )}
                      {zone.requires_registration && (
                        <Badge variant="outline">{t('requiresRegistration')}</Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openQRDialog(zone)}
                      >
                        <QrCodeIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAccessRulesDialog(zone)}
                        title={t('accessRules')}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openStaffDialog(zone)}
                        title={t('staffAssignments')}
                      >
                        <UserCog className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(zone)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openDeleteDialog(zone)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Zone Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createZone')}</DialogTitle>
            <DialogDescription>{t('zoneSettings')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">{t('zoneName')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={t('zoneName')}
              />
            </div>

            <div>
              <Label htmlFor="zone_type">{t('zoneType')}</Label>
              <Select
                value={formData.zone_type}
                onValueChange={(value) =>
                  setFormData({ ...formData, zone_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">{t('zoneTypeGeneral')}</SelectItem>
                  <SelectItem value="registration">{t('zoneTypeRegistration')}</SelectItem>
                  <SelectItem value="vip">{t('zoneTypeVIP')}</SelectItem>
                  <SelectItem value="workshop">{t('zoneTypeWorkshop')}</SelectItem>
                  <SelectItem value="speaker">{t('zoneTypeSpeaker')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="open_time">{t('openTime')}</Label>
                <Input
                  id="open_time"
                  type="time"
                  value={formData.open_time}
                  onChange={(e) =>
                    setFormData({ ...formData, open_time: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="close_time">{t('closeTime')}</Label>
                <Input
                  id="close_time"
                  type="time"
                  value={formData.close_time}
                  onChange={(e) =>
                    setFormData({ ...formData, close_time: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="is_registration_zone">
                  {t('isRegistrationZone')}
                </Label>
                <Switch
                  id="is_registration_zone"
                  checked={formData.is_registration_zone}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_registration_zone: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="requires_registration">
                  {t('requiresRegistration')}
                </Label>
                <Switch
                  id="requires_registration"
                  checked={formData.requires_registration}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, requires_registration: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">{t('active')}</Label>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate}>{t('create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Zone Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editZone')}</DialogTitle>
            <DialogDescription>{t('zoneSettings')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit_name">{t('zoneName')}</Label>
              <Input
                id="edit_name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={t('zoneName')}
              />
            </div>

            <div>
              <Label htmlFor="edit_zone_type">{t('zoneType')}</Label>
              <Select
                value={formData.zone_type}
                onValueChange={(value) =>
                  setFormData({ ...formData, zone_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">{t('zoneTypeGeneral')}</SelectItem>
                  <SelectItem value="registration">{t('zoneTypeRegistration')}</SelectItem>
                  <SelectItem value="vip">{t('zoneTypeVIP')}</SelectItem>
                  <SelectItem value="workshop">{t('zoneTypeWorkshop')}</SelectItem>
                  <SelectItem value="speaker">{t('zoneTypeSpeaker')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_open_time">{t('openTime')}</Label>
                <Input
                  id="edit_open_time"
                  type="time"
                  value={formData.open_time}
                  onChange={(e) =>
                    setFormData({ ...formData, open_time: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit_close_time">{t('closeTime')}</Label>
                <Input
                  id="edit_close_time"
                  type="time"
                  value={formData.close_time}
                  onChange={(e) =>
                    setFormData({ ...formData, close_time: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit_is_registration_zone">
                  {t('isRegistrationZone')}
                </Label>
                <Switch
                  id="edit_is_registration_zone"
                  checked={formData.is_registration_zone}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_registration_zone: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="edit_requires_registration">
                  {t('requiresRegistration')}
                </Label>
                <Switch
                  id="edit_requires_registration"
                  checked={formData.requires_registration}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, requires_registration: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="edit_is_active">{t('active')}</Label>
                <Switch
                  id="edit_is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleEdit}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteZone')}</DialogTitle>
            <DialogDescription>
              {t('confirmDeleteZone', { name: selectedZone?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('zoneQRCode')}</DialogTitle>
            <DialogDescription>{t('scanToSelectZone')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {selectedZone && (
              <>
                <img
                  src={`${api.defaults.baseURL}/api/zones/${selectedZone.id}/qr`}
                  alt={`QR code for ${selectedZone.name}`}
                  className="w-64 h-64"
                />
                <p className="text-center font-medium">{selectedZone.name}</p>
                <Button onClick={downloadQR} variant="outline">
                  {t('downloadQR')}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Access Rules Dialog */}
      <Dialog open={showAccessRulesDialog} onOpenChange={setShowAccessRulesDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('accessRules')} - {selectedZone?.name}</DialogTitle>
            <DialogDescription>{t('categoryAccess')}</DialogDescription>
          </DialogHeader>
          {selectedZone && eventId && (
            <ZoneAccessRules zoneId={selectedZone.id} eventId={eventId} />
          )}
        </DialogContent>
      </Dialog>

      {/* Staff Assignments Dialog */}
      <Dialog open={showStaffDialog} onOpenChange={setShowStaffDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('staffAssignments')} - {selectedZone?.name}</DialogTitle>
            <DialogDescription>{t('manageStaffAccess')}</DialogDescription>
          </DialogHeader>
          {selectedZone && (
            <StaffZoneAssignments zoneId={selectedZone.id} zoneName={selectedZone.name} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

