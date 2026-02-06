import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Calendar, Clock } from 'lucide-react';
import api from '@/lib/api';
import type { MovementHistoryEntry } from '@/types';

interface AttendeeMovementTimelineProps {
  attendeeId: string;
}

export function AttendeeMovementTimeline({ attendeeId }: AttendeeMovementTimelineProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<MovementHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when attendeeId changes
  }, [attendeeId]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const response = await api.get<MovementHistoryEntry[]>(
        `/api/attendees/${attendeeId}/zone-history`
      );
      setHistory(response.data);
    } catch (error) {
      console.error('Failed to load movement history:', error);
    } finally {
      setLoading(false);
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

  if (history.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {t('noMovementHistory')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('movementHistory')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-4">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

          {history.map((entry, index) => (
            <div key={entry.checkin.id} className="relative flex gap-4 pl-10">
              {/* Timeline dot */}
              <div className="absolute left-2 w-4 h-4 rounded-full bg-primary border-4 border-background" />

              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <h4 className="font-semibold">{entry.zone_name}</h4>
                      <Badge variant="outline">{entry.zone_type}</Badge>
                    </div>

                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(entry.checkin.event_day).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(entry.checkin.checked_in_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  {index === 0 && (
                    <Badge className="bg-green-500">
                      {t('currentLocation')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

