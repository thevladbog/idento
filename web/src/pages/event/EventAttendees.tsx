import { useState, useEffect } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrintBadgeDialog } from "@/components/PrintBadgeDialog";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { CSVImportEnhanced } from "@/components/CSVImportEnhanced";
import { EditAttendeeDialog } from "@/components/EditAttendeeDialog";
import { BlockAttendeeDialog } from "@/components/BlockAttendeeDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/utils/dateFormat";
import api from "@/lib/api";
import type { Attendee, Event } from "@/types";
import { Plus, Download, Hash, Search, Trash2, ShieldOff, Filter } from "lucide-react";
import { toast } from "sonner";

interface EventContext {
  event: Event | null;
  reloadEvent: () => void;
}

export default function EventAttendees() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { event } = useOutletContext<EventContext>();
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [filteredAttendees, setFilteredAttendees] = useState<Attendee[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);
  const [newAttendee, setNewAttendee] = useState({
    first_name: "",
    last_name: "",
    email: "",
    company: "",
    position: "",
  });

  useEffect(() => {
    if (eventId) {
      loadAttendees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  useEffect(() => {
    let filtered = attendees;

    // Filter by category
    if (categoryFilter !== "all") {
      filtered = filtered.filter(
        (a) => a.custom_fields?.category === categoryFilter
      );
    }

    // Filter by search query
    if (searchQuery.trim() !== "") {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.first_name.toLowerCase().includes(query) ||
          a.last_name.toLowerCase().includes(query) ||
          a.email.toLowerCase().includes(query) ||
          a.code.toLowerCase().includes(query) ||
          (a.company && a.company.toLowerCase().includes(query))
      );
    }

    setFilteredAttendees(filtered);
  }, [searchQuery, categoryFilter, attendees]);

  const loadAttendees = async () => {
    try {
      const response = await api.get<Attendee[]>(
        `/api/events/${eventId}/attendees`
      );
      const attendeesData = response.data;
      setAttendees(attendeesData);
      setFilteredAttendees(attendeesData);

      // Extract unique categories from custom_fields
      const uniqueCategories = new Set<string>();
      attendeesData.forEach((attendee) => {
        if (attendee.custom_fields?.category !== undefined && attendee.custom_fields?.category !== null) {
          uniqueCategories.add(String(attendee.custom_fields.category));
        }
      });
      setCategories(Array.from(uniqueCategories).sort());
    } catch (error) {
      console.error("Failed to load attendees", error);
    }
  };

  const handleAddAttendee = async () => {
    try {
      await api.post(`/api/events/${eventId}/attendees`, newAttendee);
      setIsAddDialogOpen(false);
      setNewAttendee({
        first_name: "",
        last_name: "",
        email: "",
        company: "",
        position: "",
      });
      loadAttendees();
    } catch (error) {
      console.error("Failed to add attendee", error);
      toast.error(t("failedToAddAttendee"));
    }
  };

  const handleGenerateCodes = async () => {
    if (!confirm(t("confirmGenerateCodes"))) return;

    setIsGeneratingCodes(true);
    try {
      await api.post(`/api/events/${eventId}/attendees/generate-codes`);
      toast.success(t("codesGenerated"));
      loadAttendees();
    } catch (error) {
      console.error("Failed to generate codes", error);
      toast.error(t("failedToGenerateCodes"));
    } finally {
      setIsGeneratingCodes(false);
    }
  };

  const handleExport = async () => {
    try {
      // Generate CSV from filtered attendees
      const headers = [
        "First Name",
        "Last Name",
        "Email",
        "Company",
        "Position",
        "Code",
        "Category",
        "Checked In",
        "Check-in Time",
      ];

      const rows = filteredAttendees.map((a) => [
        a.first_name,
        a.last_name,
        a.email,
        a.company || "",
        a.position || "",
        a.code,
        a.custom_fields?.category || "",
        a.checkin_status ? "Yes" : "No",
        a.checked_in_at || "",
      ]);

      const csv = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = categoryFilter !== "all"
        ? `attendees-${eventId}-${categoryFilter}.csv`
        : `attendees-${eventId}.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      toast.success(t("exportSuccess", { count: filteredAttendees.length }));
    } catch (error) {
      console.error("Failed to export", error);
      toast.error(t("exportFailed"));
    }
  };

  const handleUnblock = async (attendeeId: string) => {
    if (!confirm(t("confirmUnblock"))) return;

    try {
      await api.post(`/api/attendees/${attendeeId}/unblock`);
      loadAttendees();
    } catch (error) {
      console.error("Failed to unblock attendee", error);
      toast.error(t("failedToUnblockAttendee"));
    }
  };

  const handleDelete = async (attendeeId: string) => {
    if (!confirm(t("confirmDeleteAttendee"))) return;

    try {
      await api.delete(`/api/attendees/${attendeeId}`);
      loadAttendees();
    } catch (error) {
      console.error("Failed to delete attendee", error);
      toast.error(t("failedToDeleteAttendee"));
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* Actions bar */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 flex-1">
            <div className="flex-1 min-w-[200px] max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchByNameEmailCode")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {categories.length > 0 && (
              <div className="min-w-[180px]">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder={t("filterByCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allCategories")}</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <CSVImportEnhanced
              eventId={eventId!}
              onImportComplete={loadAttendees}
            />

            <Button
              variant="outline"
              onClick={handleGenerateCodes}
              disabled={isGeneratingCodes}
            >
              <Hash className="mr-2 h-4 w-4" />
              {isGeneratingCodes ? t("generating") : t("generateCodes")}
            </Button>

            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              {t("exportCSV")}
            </Button>

            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("addAttendee")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("addAttendee")}</DialogTitle>
                  <DialogDescription>{t("manuallyRegister")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t("firstName")}</Label>
                      <Input
                        value={newAttendee.first_name}
                        onChange={(e) =>
                          setNewAttendee({
                            ...newAttendee,
                            first_name: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>{t("lastName")}</Label>
                      <Input
                        value={newAttendee.last_name}
                        onChange={(e) =>
                          setNewAttendee({
                            ...newAttendee,
                            last_name: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{t("email")}</Label>
                    <Input
                      type="email"
                      value={newAttendee.email}
                      onChange={(e) =>
                        setNewAttendee({
                          ...newAttendee,
                          email: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t("company")}</Label>
                    <Input
                      value={newAttendee.company}
                      onChange={(e) =>
                        setNewAttendee({
                          ...newAttendee,
                          company: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t("position")}</Label>
                    <Input
                      value={newAttendee.position}
                      onChange={(e) =>
                        setNewAttendee({
                          ...newAttendee,
                          position: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                  >
                    {t("cancel")}
                  </Button>
                  <Button onClick={handleAddAttendee}>{t("add")}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>
            {t("totalAttendees")}:{" "}
            <strong className="text-foreground">{attendees.length}</strong>
          </span>
          <span>
            {t("checkedIn")}:{" "}
            <strong className="text-foreground">
              {attendees.filter((a) => a.checkin_status).length}
            </strong>
          </span>
          <span>
            {t("showingResults")}:{" "}
            <strong className="text-foreground">
              {filteredAttendees.length}
            </strong>
          </span>
        </div>

        {/* Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("attendeeName")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("company")}</TableHead>
                <TableHead>{t("code")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAttendees.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    {attendees.length === 0 ? t("noAttendees") : t("noResults")}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAttendees.map((attendee) => (
                  <TableRow key={attendee.id}>
                    <TableCell className="font-medium">
                      {attendee.first_name} {attendee.last_name}
                    </TableCell>
                    <TableCell>{attendee.email}</TableCell>
                    <TableCell>{attendee.company || "-"}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-2 py-1 rounded font-mono">
                        {attendee.code}
                      </code>
                    </TableCell>
                    <TableCell>
                      {attendee.blocked ? (
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <span className="text-red-600 dark:text-red-400 cursor-help inline-flex items-center gap-1">
                              🚫 {t("blocked")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <div>
                              <p className="font-semibold mb-1">
                                {t("blockReason")}:
                              </p>
                              <p className="text-sm">
                                {attendee.block_reason || t("noReasonProvided")}
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : attendee.checkin_status ? (
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <span className="text-green-600 dark:text-green-400 cursor-help">
                              ✓ {t("checkedIn")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <div>
                              {attendee.checked_in_at && (
                                <p className="text-sm mb-1">
                                  <span className="font-semibold">
                                    {t("checkinTime")}:
                                  </span>{" "}
                                  {formatDateTime(attendee.checked_in_at)}
                                </p>
                              )}
                              {attendee.checked_in_by_email && (
                                <p className="text-sm">
                                  <span className="font-semibold">
                                    {t("checkedInBy")}:
                                  </span>{" "}
                                  {attendee.checked_in_by_email}
                                </p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("pending")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <EditAttendeeDialog
                          attendee={attendee}
                          fieldSchema={event?.field_schema}
                          onUpdated={loadAttendees}
                        />

                        {attendee.blocked ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("unblock")}
                            onClick={() => handleUnblock(attendee.id)}
                          >
                            <ShieldOff className="h-4 w-4 text-green-600" />
                          </Button>
                        ) : (
                          <BlockAttendeeDialog
                            attendee={attendee}
                            onUpdated={loadAttendees}
                          />
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("delete")}
                          onClick={() => handleDelete(attendee.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>

                        <QRCodeDisplay attendee={attendee} />
                        <PrintBadgeDialog
                          attendee={attendee}
                          eventId={eventId}
                          template={event?.custom_fields?.badgeTemplate as { width_mm: number; height_mm: number; dpi: 203 | 300; elements: import('@/utils/zpl').BadgeElement[] } | undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </TooltipProvider>
  );
}
