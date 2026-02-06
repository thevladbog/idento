import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Plus,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Settings,
  Download,
  Hash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";
import type { Event, Attendee } from "@/types";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PrintBadgeDialog } from "@/components/PrintBadgeDialog";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { CSVImportEnhanced } from "@/components/CSVImportEnhanced";
import { AssignStaffDialog } from "@/components/AssignStaffDialog";

const createAttendeeSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email().optional().or(z.literal("")),
  company: z.string().optional(),
  position: z.string().optional(),
});

type CreateAttendeeFormValues = z.infer<typeof createAttendeeSchema>;

export default function EventDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAttendeeFormValues>({
    resolver: zodResolver(createAttendeeSchema),
  });

  useEffect(() => {
    if (id) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when id changes
  }, [id]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Parallel fetch could be better but sequential is fine for now
      const [attendeesRes, eventRes] = await Promise.all([
        api.get<Attendee[]>(`/api/events/${id}/attendees`),
        api.get<Event>(`/api/events/${id}`),
      ]);

      setAttendees(attendeesRes.data || []);
      setEvent(eventRes.data);
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateCodes = async () => {
    if (!id) return;

    try {
      await api.post(`/api/events/${id}/attendees/generate-codes`);
      await fetchData(); // Refresh data to show new codes
    } catch (error) {
      console.error("Failed to generate codes", error);
    }
  };

  const handleExportCSV = async () => {
    if (!id) return;

    try {
      const response = await api.get(`/api/events/${id}/attendees/export`, {
        responseType: "blob",
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${event?.name || "attendees"}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Failed to export CSV", error);
    }
  };

  const onSubmit = async (data: CreateAttendeeFormValues) => {
    try {
      await api.post(`/api/events/${id}/attendees`, {
        ...data,
        custom_fields: {},
      });
      setIsDialogOpen(false);
      reset();
      fetchData();
    } catch (error) {
      console.error("Failed to create attendee", error);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button variant="ghost" asChild className="pl-0">
            <Link to="/events">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t("backToEvents")}
            </Link>
          </Button>
        </div>

        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">
              {event?.name || "Event Details"}
            </h1>
            <p className="text-muted-foreground text-sm">{id}</p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={`/events/${id}/templates`}>
                <Settings className="mr-2 h-4 w-4" /> {t("editTemplate")}
              </Link>
            </Button>
            <AssignStaffDialog eventId={id!} onAssigned={() => {}} />
            <CSVImportEnhanced eventId={id!} onImportComplete={fetchData} />
            <Button variant="outline" onClick={handleGenerateCodes}>
              <Hash className="mr-2 h-4 w-4" /> {t("generateTicketCodes")}
            </Button>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="mr-2 h-4 w-4" /> {t("exportCsv")}
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> {t("addAttendee")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Attendee</DialogTitle>
                  <DialogDescription>
                    Manually register a new attendee.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)}>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="first_name" className="text-right">
                        First Name
                      </Label>
                      <div className="col-span-3">
                        <Input id="first_name" {...register("first_name")} />
                        {errors.first_name && (
                          <p className="text-sm text-destructive mt-1">
                            {errors.first_name.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="last_name" className="text-right">
                        Last Name
                      </Label>
                      <div className="col-span-3">
                        <Input id="last_name" {...register("last_name")} />
                        {errors.last_name && (
                          <p className="text-sm text-destructive mt-1">
                            {errors.last_name.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="email" className="text-right">
                        Email
                      </Label>
                      <div className="col-span-3">
                        <Input id="email" type="email" {...register("email")} />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="company" className="text-right">
                        Company
                      </Label>
                      <div className="col-span-3">
                        <Input id="company" {...register("company")} />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="position" className="text-right">
                        Position
                      </Label>
                      <div className="col-span-3">
                        <Input id="position" {...register("position")} />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isSubmitting}>
                      Add Attendee
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                    No attendees found.
                  </TableCell>
                </TableRow>
              ) : (
                attendees.map((attendee) => (
                  <TableRow key={attendee.id}>
                    <TableCell className="font-medium">
                      {attendee.first_name} {attendee.last_name}
                    </TableCell>
                    <TableCell>{attendee.email}</TableCell>
                    <TableCell>{attendee.company}</TableCell>
                    <TableCell>
                      {attendee.checkin_status ? (
                        <span className="flex items-center text-green-600">
                          <CheckCircle className="w-4 h-4 mr-1" /> Checked In
                        </span>
                      ) : (
                        <span className="flex items-center text-slate-400">
                          <XCircle className="w-4 h-4 mr-1" /> Pending
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <QRCodeDisplay attendee={attendee} />
                        <PrintBadgeDialog attendee={attendee} eventId={id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}
