import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/utils/dateFormat';
import api from '@/lib/api';
import type { Event } from '@/types';
import { Calendar, MapPin, Users } from 'lucide-react';

export default function CheckinSelectEvent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      const response = await api.get<Event[]>('/api/events');
      setEvents(response.data);
    } catch (error) {
      console.error('Failed to load events', error);
    } finally {
      setLoading(false);
    }
  };

  const selectEvent = (eventId: string) => {
    navigate(`/checkin-fullscreen?event=${eventId}`);
  };

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-muted-foreground">{t('loading')}</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold mb-2">{t('selectEventForCheckin')}</h1>
            <p className="text-muted-foreground">{t('selectEventForCheckinDesc')}</p>
          </div>

          {events.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">{t('noEvents')}</p>
                <Button onClick={() => navigate('/events')} className="mt-4">
                  {t('createEvent')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {events.map((event) => (
                <Card
                  key={event.id}
                  className="cursor-pointer hover:bg-accent hover:border-primary/40 transition-all duration-200"
                  onClick={() => selectEvent(event.id)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-primary" />
                      {event.name}
                    </CardTitle>
                    <CardDescription className="space-y-1">
                      {event.start_date && (
                        <div className="flex items-center gap-2 text-xs">
                          <Calendar className="h-3 w-3" />
                          {formatDate(event.start_date)}
                        </div>
                      )}
                      {event.location && (
                        <div className="flex items-center gap-2 text-xs">
                          <MapPin className="h-3 w-3" />
                          {event.location}
                        </div>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="outline">
                      <Users className="mr-2 h-4 w-4" />
                      {t('startCheckin')}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

