import { useEffect, useState } from 'react';
import { useParams, Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/utils/dateFormat';
import api from '@/lib/api';
import type { Event } from '@/types';
import { ArrowLeft, Users, FileText, Settings, UserCog, QrCode, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EventLayout() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();
  const [event, setEvent] = useState<Event | null>(null);

  useEffect(() => {
    if (eventId) {
      loadEvent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const loadEvent = async () => {
    try {
      const response = await api.get<Event>(`/api/events/${eventId}`);
      setEvent(response.data);
      console.log('EventLayout - Event loaded:', {
        hasCustomFields: !!response.data.custom_fields,
        hasBadgeTemplate: !!response.data.custom_fields?.badgeTemplate,
        badgeTemplate: response.data.custom_fields?.badgeTemplate
      });
    } catch (error) {
      console.error('Failed to load event', error);
    }
  };

  const menuItems = [
    {
      path: `/events/${eventId}`,
      label: t('attendees'),
      icon: Users,
      exact: true
    },
    {
      path: `/events/${eventId}/zones`,
      label: t('zones'),
      icon: MapPin
    },
    {
      path: `/events/${eventId}/template`,
      label: t('badgeTemplate'),
      icon: FileText
    },
    {
      path: `/events/${eventId}/staff`,
      label: t('staff'),
      icon: UserCog
    },
    {
      path: `/events/${eventId}/checkin`,
      label: t('checkin'),
      icon: QrCode
    },
    {
      path: `/events/${eventId}/settings`,
      label: t('settings'),
      icon: Settings
    }
  ];

  const isActive = (path: string, exact: boolean = false) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <Link to="/events">
            <Button variant="ghost" className="pl-0 mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('backToEvents')}
            </Button>
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{event?.name || t('loading')}</h1>
              <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                {event?.start_date && (
                  <span>{formatDate(event.start_date)}</span>
                )}
                {event?.location && <span>{event.location}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Layout with sidebar */}
        <div className="flex gap-6">
          {/* Sidebar */}
          <aside className="w-64 flex-shrink-0">
            <nav className="space-y-1 sticky top-6">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path, item.exact);
                
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            <Outlet context={{ event, reloadEvent: loadEvent }} />
          </main>
        </div>
      </div>
    </Layout>
  );
}

