import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Calendar, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatDate } from '@/utils/dateFormat';
import api from '@/lib/api';
import type { Event } from '@/types';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/Layout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const createEventSchema = z.object({
  name: z.string().min(2, "Name is required"),
  location: z.string().optional(),
  start_date: z.string().optional(), // We'll handle dates as strings for now
  end_date: z.string().optional(),
});

type CreateEventFormValues = z.infer<typeof createEventSchema>;

export default function EventsPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateEventFormValues>({
    resolver: zodResolver(createEventSchema),
  });

  const fetchEvents = async () => {
    try {
      const response = await api.get<Event[]>('/api/events');
      setEvents(response.data || []);
    } catch (error) {
      console.error('Failed to fetch events', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const onSubmit = async (data: CreateEventFormValues) => {
    try {
        // Convert empty strings to null/undefined if needed by backend, 
        // but our Go backend handles empty strings fine or we can adjust logic there.
        // For dates, we might need to format them to RFC3339 if the input gives something else.
        // HTML datetime-local gives "YYYY-MM-DDTHH:mm". Go's time.Time default UnmarshalJSON expects RFC3339.
        // We might need to append ":00Z" or similar if we want to be precise, but let's try raw first.
        
        const payload = {
            ...data,
            start_date: data.start_date ? new Date(data.start_date).toISOString() : null,
            end_date: data.end_date ? new Date(data.end_date).toISOString() : null,
        }

      await api.post('/api/events', payload);
      setIsDialogOpen(false);
      reset();
      fetchEvents();
    } catch (error) {
      console.error('Failed to create event', error);
      // Handle error (maybe show toast)
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">{t('events')}</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> {t('createEvent')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('createEvent')}</DialogTitle>
              <DialogDescription>
                {t('eventDescription')}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    {t('eventName')}
                  </Label>
                  <div className="col-span-3">
                    <Input id="name" {...register('name')} />
                    {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="location" className="text-right">
                    {t('eventLocation')}
                  </Label>
                   <div className="col-span-3">
                    <Input id="location" {...register('location')} />
                  </div>
                </div>
                 <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="start_date" className="text-right">
                    {t('eventDate')}
                  </Label>
                  <div className="col-span-3">
                    <Input id="start_date" type="datetime-local" {...register('start_date')} />
                  </div>
                </div>
                 <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="end_date" className="text-right">
                    {t('endDate')}
                  </Label>
                  <div className="col-span-3">
                     <Input id="end_date" type="datetime-local" {...register('end_date')} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>{t('createEvent')}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div>{t('loading')}</div>
      ) : events.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          {t('noEventsFound')}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader>
                <CardTitle>{event.name}</CardTitle>
                <CardDescription>
                    {event.location && (
                        <span className="flex items-center mt-1">
                            <MapPin className="mr-1 h-3 w-3" /> {event.location}
                        </span>
                    )}
                     {event.start_date && (
                        <span className="flex items-center mt-1">
                            <Calendar className="mr-1 h-3 w-3" /> 
                            {formatDate(event.start_date)}
                        </span>
                    )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                    ID: {event.id}
                </p>
              </CardContent>
              <CardFooter>
                  <Button variant="secondary" className="w-full" asChild>
                      <Link to={`/events/${event.id}`}>{t('manage')}</Link>
                  </Button>
              </CardFooter>
            </Card>
          ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

