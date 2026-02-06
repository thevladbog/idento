import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/Layout';
import { formatTime } from '@/utils/dateFormat';
import api from '@/lib/api';
import type { Event, Attendee } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Search, CheckCircle, Camera } from 'lucide-react';

export default function CheckinPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [scanMode, setScanMode] = useState(false);

  useEffect(() => {
    fetchUserEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const fetchUserEvents = async () => {
    try {
      // For staff: get only assigned events
      // For admin/manager: get all events
      const response = await api.get<Event[]>('/api/events');
      setEvents(response.data || []);
      if (response.data && response.data.length > 0) {
        setSelectedEvent(response.data[0]);
        fetchAttendees(response.data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch events', error);
    }
  };

  const fetchAttendees = async (eventId: string) => {
    try {
      const response = await api.get<Attendee[]>(`/api/events/${eventId}/attendees`);
      setAttendees(response.data || []);
    } catch (error) {
      console.error('Failed to fetch attendees', error);
    }
  };

  const handleCheckin = async (attendee: Attendee) => {
    try {
      // Update checkin status
      await api.put(`/api/attendees/${attendee.id}`, {
        ...attendee,
        checkin_status: true,
        checked_in_at: new Date().toISOString(),
      });
      
      // Refresh attendees
      if (selectedEvent) {
        fetchAttendees(selectedEvent.id);
      }
    } catch (error) {
      console.error('Failed to check in attendee', error);
    }
  };

  const filteredAttendees = attendees.filter(a => {
    const query = searchQuery.toLowerCase();
    return (
      a.first_name.toLowerCase().includes(query) ||
      a.last_name.toLowerCase().includes(query) ||
      a.email.toLowerCase().includes(query) ||
      a.code.toLowerCase().includes(query) ||
      a.company.toLowerCase().includes(query)
    );
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">{t('checkinInterface')}</h1>
          <p className="text-muted-foreground">{t('checkinInterfaceDesc')}</p>
        </div>

        {/* Event Selector */}
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{selectedEvent?.name || t('selectEvent')}</h3>
              <p className="text-sm text-muted-foreground">
                {attendees.filter(a => a.checkin_status).length} / {attendees.length} {t('checkedIn')}
              </p>
            </div>
            {events.length > 1 && (
              <select
                className="h-10 px-3 py-2 border rounded-md bg-background"
                value={selectedEvent?.id}
                onChange={(e) => {
                  const event = events.find(ev => ev.id === e.target.value);
                  if (event) {
                    setSelectedEvent(event);
                    fetchAttendees(event.id);
                  }
                }}
              >
                {events.map(event => (
                  <option key={event.id} value={event.id}>{event.name}</option>
                ))}
              </select>
            )}
          </div>
        </Card>

        {/* Search / Scan */}
        <div className="mb-6 flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('searchByNameEmailCode')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" onClick={() => setScanMode(!scanMode)}>
            <Camera className="mr-2 h-4 w-4" /> {scanMode ? t('manualSearch') : t('scanQR')}
          </Button>
        </div>

        {/* Attendees List */}
        <div className="space-y-2">
          {filteredAttendees.map((attendee) => (
            <Card key={attendee.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-semibold text-lg">
                    {attendee.first_name} {attendee.last_name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {attendee.company} • {attendee.email}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('code')}: <span className="font-mono font-bold">{attendee.code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {attendee.checkin_status ? (
                    <div className="flex items-center text-green-600">
                      <CheckCircle className="w-6 h-6 mr-2" />
                      <div className="text-right">
                        <div className="font-semibold">{t('checkedIn')}</div>
                        {attendee.checked_in_at && (
                          <div className="text-xs">
                            {formatTime(attendee.checked_in_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => handleCheckin(attendee)}
                      size="lg"
                    >
                      <CheckCircle className="mr-2 h-5 w-5" />
                      {t('checkIn')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
          
          {filteredAttendees.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery ? t('noResultsFound') : t('noAttendees')}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

