import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import api from "@/lib/api";
import type { Event, Attendee } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Search,
  Camera,
  CheckCircle,
  AlertTriangle,
  XCircle,
  X,
  Settings,
  Printer,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useScanner } from "@/hooks/useScanner";
import { agentApi } from "@/lib/agent";
import { loadEventFonts } from "@/lib/fonts";
import { generateZPL } from "@/utils/zpl";
import { formatDateTime } from "@/utils/dateFormat";
import {
  renderMarkdownTemplate,
  getDefaultAttendeeTemplate,
} from "@/utils/markdownTemplate";
import { toast } from "sonner";

type ScanStatus = "idle" | "success" | "warning" | "error";

interface ScanResult {
  status: ScanStatus;
  attendee?: Attendee;
  message: string;
}

export default function CheckinFullscreenPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [scanMode, setScanMode] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [stats, setStats] = useState({ total: 0, checkedIn: 0 });

  // Autocomplete
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredAttendees, setFilteredAttendees] = useState<Attendee[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Checkin settings
  const [showSettings, setShowSettings] = useState(false);
  const [badgeTypeField, setBadgeTypeField] = useState<string>("");
  const [printEnabled, setPrintEnabled] = useState(false);
  const [manualPrint, setManualPrint] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [agentConnected, setAgentConnected] = useState(false);

  // Scanner integration
  const { lastScan, clearScan } = useScanner(scanMode);

  useEffect(() => {
    fetchUserEvents();
    loadSettings();
    checkAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      fetchAttendees(selectedEvent.id);
      // Load custom fonts for this event
      loadEventFonts(selectedEvent.id);
    }
  }, [selectedEvent]);

  useEffect(() => {
    if (attendees.length > 0) {
      setStats({
        total: attendees.length,
        checkedIn: attendees.filter((a) => a.checkin_status).length,
      });
    }
  }, [attendees]);

  // Handle scanned data from COM scanner
  useEffect(() => {
    if (lastScan && lastScan.code) {
      handleSearch(lastScan.code);
      clearScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to lastScan only
  }, [lastScan]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadSettings = () => {
    const saved = localStorage.getItem("checkin_settings");
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        setBadgeTypeField(settings.badgeTypeField || "");
        setPrintEnabled(settings.printEnabled || false);
        setManualPrint(settings.manualPrint || false);
        setSelectedPrinter(settings.selectedPrinter || "");
      } catch (error) {
        console.error("Failed to load settings", error);
      }
    }
  };

  const saveSettings = () => {
    const settings = {
      badgeTypeField,
      printEnabled,
      manualPrint,
      selectedPrinter,
    };
    localStorage.setItem("checkin_settings", JSON.stringify(settings));
    toast.success(t("settingsSaved"));
    setShowSettings(false);
  };

  const checkAgent = async () => {
    const healthy = await agentApi.checkHealth();
    setAgentConnected(healthy);
    if (healthy) {
      const printerList = await agentApi.getPrinters();
      setPrinters(printerList);

      // Restore saved printer if it exists in the list, otherwise pick first
      const saved = localStorage.getItem("checkin_settings");
      if (saved) {
        try {
          const settings = JSON.parse(saved);
          if (
            settings.selectedPrinter &&
            printerList.includes(settings.selectedPrinter)
          ) {
            setSelectedPrinter(settings.selectedPrinter);
          } else if (printerList.length > 0 && !selectedPrinter) {
            setSelectedPrinter(printerList[0]);
          }
        } catch {
          if (printerList.length > 0 && !selectedPrinter) {
            setSelectedPrinter(printerList[0]);
          }
        }
      } else if (printerList.length > 0 && !selectedPrinter) {
        setSelectedPrinter(printerList[0]);
      }
    }
  };

  const printBadge = async (attendee: Attendee) => {
    if (!printEnabled || !selectedPrinter || !agentConnected) {
      return;
    }

    if (!selectedEvent) {
      toast.error(t("noEventSelected"));
      return;
    }

    try {
      // Get template from event
      const rawTemplate = selectedEvent.custom_fields?.badgeTemplate;
      if (!rawTemplate || typeof rawTemplate !== 'object') {
        toast.error(t("noTemplateConfigured"));
        return;
      }
      const template = rawTemplate as { width_mm: number; height_mm: number; dpi: number; elements: import('@/utils/zpl').BadgeElement[] };

      // Prepare attendee data
      const attendeeData = {
        first_name: attendee.first_name,
        last_name: attendee.last_name,
        email: attendee.email,
        company: attendee.company || "",
        position: attendee.position || "",
        code: attendee.code,
        ...(attendee.custom_fields || {}),
      };

      // Generate ZPL
      const zpl = await generateZPL(
        {
          widthMM: template.width_mm,
          heightMM: template.height_mm,
          dpi: template.dpi as 203 | 300,
        },
        template.elements,
        attendeeData
      );

      // Send to printer
      await agentApi.print({
        printer_name: selectedPrinter,
        zpl: zpl,
      });

      toast.success(t("badgePrinted"));
    } catch (error) {
      console.error("Print failed", error);
      toast.error(t("printFailed"));
    }
  };

  const fetchUserEvents = async () => {
    try {
      const response = await api.get<Event[]>("/api/events");
      setEvents(response.data || []);
      if (response.data && response.data.length > 0) {
        setSelectedEvent(response.data[0]);
      }
    } catch (error) {
      console.error("Failed to fetch events", error);
    }
  };

  const fetchAttendees = async (eventId: string) => {
    try {
      const response = await api.get<Attendee[]>(
        `/api/events/${eventId}/attendees`
      );
      setAttendees(response.data || []);
    } catch (error) {
      console.error("Failed to fetch attendees", error);
    }
  };

  const handleCheckin = async (attendee: Attendee) => {
    try {
      // Check if attendee is blocked
      if (attendee.blocked) {
        setScanResult({
          status: "error",
          attendee: attendee,
          message: `${t("attendeeBlocked")}\n${t("reason")}: ${
            attendee.block_reason || t("noReasonProvided")
          }`,
        });
        setTimeout(() => setScanResult(null), 8000);
        return;
      }

      const isFirstCheckin = !attendee.checkin_status;

      // Update checkin status
      await api.put(`/api/attendees/${attendee.id}`, {
        ...attendee,
        checkin_status: true,
        checked_in_at: isFirstCheckin
          ? new Date().toISOString()
          : attendee.checked_in_at,
      });

      // Show result
      setScanResult({
        status: isFirstCheckin ? "success" : "warning",
        attendee: attendee,
        message: isFirstCheckin ? t("checkinSuccess") : t("alreadyCheckedIn"),
      });

      // Print badge if enabled and NOT manual mode (only on first checkin)
      if (isFirstCheckin && !manualPrint) {
        await printBadge(attendee);
      }

      // Refresh attendees
      if (selectedEvent) {
        fetchAttendees(selectedEvent.id);
      }

      // Auto-hide after 3 seconds if manual print is disabled
      if (!manualPrint) {
        setTimeout(() => {
          setScanResult(null);
          setSearchQuery("");
        }, 3000);
      }
    } catch (error) {
      console.error("Failed to check in attendee", error);
      setScanResult({
        status: "error",
        message: t("checkinFailed"),
      });
      setTimeout(() => setScanResult(null), 3000);
    }
  };

  const handleSearchQueryChange = (query: string) => {
    setSearchQuery(query);

    if (query.length < 2) {
      setShowSuggestions(false);
      setFilteredAttendees([]);
      return;
    }

    // Filter attendees
    const filtered = attendees
      .filter(
        (a) =>
          a.code.toLowerCase().includes(query.toLowerCase()) ||
          a.email.toLowerCase().includes(query.toLowerCase()) ||
          `${a.first_name} ${a.last_name}`
            .toLowerCase()
            .includes(query.toLowerCase()) ||
          (a.company && a.company.toLowerCase().includes(query.toLowerCase()))
      )
      .slice(0, 10); // Limit to 10 results

    setFilteredAttendees(filtered);
    setShowSuggestions(filtered.length > 0);
  };

  const handleSelectAttendee = (attendee: Attendee) => {
    setShowSuggestions(false);
    setSearchQuery("");
    setFilteredAttendees([]);
    handleCheckin(attendee);
  };

  const handleSearch = (query: string) => {
    if (query.length < 2) return;

    // Try exact code match first
    const exactMatch = attendees.find(
      (a) => a.code.toLowerCase() === query.toLowerCase()
    );

    if (exactMatch) {
      handleSelectAttendee(exactMatch);
      return;
    }

    // If no exact match and we have filtered results, use first one
    if (filteredAttendees.length > 0) {
      handleSelectAttendee(filteredAttendees[0]);
      return;
    }

    // Not found
    setScanResult({
      status: "error",
      message: t("attendeeNotFound"),
    });
    setTimeout(() => {
      setScanResult(null);
      setSearchQuery("");
    }, 3000);
  };

  const getBackgroundColor = () => {
    switch (scanResult?.status) {
      case "success":
        return "bg-green-500";
      case "warning":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-background";
    }
  };

  const getIcon = () => {
    switch (scanResult?.status) {
      case "success":
        return <CheckCircle className="w-24 h-24" />;
      case "warning":
        return <AlertTriangle className="w-24 h-24" />;
      case "error":
        return <XCircle className="w-24 h-24" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`min-h-screen transition-all duration-300 ${getBackgroundColor()}`}
    >
      {/* Header Bar */}
      <div className="bg-card border-b p-4">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("checkinInterface")}</h1>
            {selectedEvent && (
              <p className="text-sm text-muted-foreground">
                {selectedEvent.name}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Stats */}
            <div className="text-right">
              <div className="text-2xl font-bold text-primary">
                {stats.checkedIn} / {stats.total}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("checkedIn")}
              </div>
            </div>

            {/* Event Selector */}
            {events.length > 1 && (
              <select
                className="h-10 px-3 py-2 border rounded-md bg-background"
                value={selectedEvent?.id}
                onChange={(e) => {
                  const event = events.find((ev) => ev.id === e.target.value);
                  if (event) {
                    setSelectedEvent(event);
                  }
                }}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            )}

            {/* Mode Toggle */}
            <Button
              variant={scanMode ? "default" : "outline"}
              onClick={() => setScanMode(!scanMode)}
            >
              <Camera className="mr-2 h-4 w-4" />
              {scanMode ? t("scanModeActive") : t("scanMode")}
            </Button>

            {/* Settings Button */}
            <Dialog open={showSettings} onOpenChange={setShowSettings}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Settings className="mr-2 h-4 w-4" />
                  {t("settings")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>{t("checkinSettings")}</DialogTitle>
                  <DialogDescription>
                    {t("checkinSettingsFullDesc")}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* Badge Type Field */}
                  <div className="space-y-2">
                    <Label htmlFor="badge-type-field">
                      {t("badgeTypeField")}
                    </Label>
                    <Select
                      value={badgeTypeField || "__none__"}
                      onValueChange={(value) =>
                        setBadgeTypeField(value === "__none__" ? "" : value)
                      }
                    >
                      <SelectTrigger id="badge-type-field">
                        <SelectValue placeholder={t("selectBadgeTypeField")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("none")}</SelectItem>
                        {selectedEvent?.field_schema &&
                          selectedEvent.field_schema.map((field) => (
                            <SelectItem key={field} value={field}>
                              {field}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("badgeTypeFieldCheckinDesc")}
                    </p>
                  </div>

                  {/* Print Badge Toggle */}
                  <div className="flex items-center justify-between space-x-2">
                    <div className="space-y-1">
                      <Label htmlFor="print-enabled">
                        {t("autoPrintBadge")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("autoPrintBadgeDesc")}
                      </p>
                    </div>
                    <Switch
                      id="print-enabled"
                      checked={printEnabled}
                      onCheckedChange={setPrintEnabled}
                    />
                  </div>

                  {/* Manual Print Toggle */}
                  {printEnabled && (
                    <div className="flex items-center justify-between space-x-2">
                      <div className="space-y-1">
                        <Label htmlFor="manual-print">{t("manualPrint")}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t("manualPrintDesc")}
                        </p>
                      </div>
                      <Switch
                        id="manual-print"
                        checked={manualPrint}
                        onCheckedChange={setManualPrint}
                      />
                    </div>
                  )}

                  {/* Printer Selection */}
                  {printEnabled && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="printer-select">{t("printer")}</Label>
                        {agentConnected ? (
                          <span className="text-xs text-green-600 flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {t("agentConnected")}
                          </span>
                        ) : (
                          <span className="text-xs text-red-600 flex items-center">
                            <XCircle className="h-3 w-3 mr-1" />
                            {t("agentDisconnected")}
                          </span>
                        )}
                      </div>
                      <Select
                        value={selectedPrinter}
                        onValueChange={setSelectedPrinter}
                        disabled={!agentConnected}
                      >
                        <SelectTrigger id="printer-select">
                          <SelectValue placeholder={t("selectPrinter")} />
                        </SelectTrigger>
                        <SelectContent>
                          {printers.map((p) => (
                            <SelectItem key={p} value={p}>
                              <Printer className="inline h-4 w-4 mr-2" />
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("printerSelectionDesc")}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowSettings(false)}
                  >
                    {t("cancel")}
                  </Button>
                  <Button onClick={saveSettings}>{t("saveSettings")}</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        className="container mx-auto p-8 flex items-center justify-center"
        style={{ minHeight: "calc(100vh - 200px)" }}
      >
        {!scanResult ? (
          /* Search Mode */
          <Card className="w-full max-w-4xl p-8">
            <div className="text-center mb-8">
              <Search className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-3xl font-bold mb-2">
                {scanMode ? t("scanQRCode") : t("searchAttendee")}
              </h2>
              <p className="text-muted-foreground">
                {scanMode ? t("scanQRCodeDesc") : t("searchAttendeeDesc")}
              </p>
            </div>

            <div className="relative" ref={inputRef}>
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-6 w-6 text-muted-foreground z-10" />
              <Input
                placeholder={t("enterCodeOrName")}
                value={searchQuery}
                onChange={(e) => handleSearchQueryChange(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleSearch(searchQuery);
                  }
                }}
                onFocus={() => {
                  if (searchQuery.length >= 2 && filteredAttendees.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                className="pl-14 text-2xl h-16"
                autoFocus
              />

              {/* Autocomplete dropdown */}
              {showSuggestions && filteredAttendees.length > 0 && (
                <Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-96 overflow-y-auto shadow-lg">
                  <div className="p-2 space-y-1">
                    {filteredAttendees.map((attendee) => (
                      <div
                        key={attendee.id}
                        onClick={() => handleSelectAttendee(attendee)}
                        className="flex flex-col py-3 px-4 cursor-pointer rounded-md hover:bg-accent transition-colors"
                      >
                        <div className="text-lg font-semibold">
                          {attendee.first_name} {attendee.last_name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {attendee.email}{" "}
                          {attendee.company && `• ${attendee.company}`}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {t("code")}:{" "}
                          <code className="bg-muted px-1 rounded">
                            {attendee.code}
                          </code>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              {t("pressEnterToSearch")}
            </div>
          </Card>
        ) : (
          /* Result Display */
          <Card
            className={`w-full max-w-4xl p-12 text-center ${
              scanResult.status === "success"
                ? "border-green-500"
                : scanResult.status === "warning"
                ? "border-yellow-500"
                : "border-red-500"
            } border-4`}
          >
            <div
              className={`flex items-center justify-center gap-4 mb-6 ${
                scanResult.status === "success"
                  ? "text-green-600"
                  : scanResult.status === "warning"
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {getIcon()}
              <h2 className="text-4xl font-bold">{scanResult.message}</h2>
            </div>

            {scanResult.attendee && (
              <div className="mt-8 p-6 bg-muted rounded-lg">
                {/* Badge Type / Category - Display prominently from checkin settings */}
                {badgeTypeField &&
                  scanResult.attendee.custom_fields?.[badgeTypeField] !== undefined &&
                  scanResult.attendee.custom_fields?.[badgeTypeField] !== null && (
                    <div className="mb-6 px-6 py-4 bg-primary/10 border-2 border-primary rounded-lg">
                      <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                        {t("badgeType")}
                      </div>
                      <div className="text-5xl font-bold text-primary">
                        {String(scanResult.attendee.custom_fields?.[badgeTypeField] ?? '')}
                      </div>
                    </div>
                  )}

                {/* Render custom template or default display */}
                <div className="markdown-preview text-center">
                  <ReactMarkdown>
                    {renderMarkdownTemplate(
                      String(selectedEvent?.custom_fields?.attendeeTemplate ?? getDefaultAttendeeTemplate()),
                      {
                        first_name: scanResult.attendee.first_name,
                        last_name: scanResult.attendee.last_name,
                        email: scanResult.attendee.email,
                        company: scanResult.attendee.company || "",
                        position: scanResult.attendee.position || "",
                        code: scanResult.attendee.code,
                        ...(scanResult.attendee.custom_fields || {}),
                      }
                    )}
                  </ReactMarkdown>
                </div>

                {scanResult.attendee.checked_in_at &&
                  scanResult.status === "warning" && (
                    <div className="mt-4 text-sm text-muted-foreground text-center">
                      {t("firstCheckinAt")}:{" "}
                      {formatDateTime(scanResult.attendee.checked_in_at)}
                    </div>
                  )}
              </div>
            )}

            <div className="mt-8 flex justify-center gap-4">
              {/* Show print button if manual print is enabled and print is enabled */}
              {manualPrint && printEnabled && scanResult.attendee && (
                <Button
                  size="lg"
                  variant="default"
                  onClick={() => {
                    if (scanResult.attendee) {
                      printBadge(scanResult.attendee);
                    }
                  }}
                  className="min-w-[180px]"
                >
                  <Printer className="mr-2 h-5 w-5" />
                  {t("print")}
                </Button>
              )}

              <Button
                size="lg"
                variant={manualPrint && printEnabled ? "outline" : "default"}
                onClick={() => {
                  setScanResult(null);
                  setSearchQuery("");
                }}
                className="min-w-[180px]"
              >
                <X className="mr-2 h-5 w-5" />
                {t("close")}
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* Footer Instructions */}
      <div className="fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur border-t p-4">
        <div className="container mx-auto flex items-center justify-center gap-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span>{t("firstCheckin")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500 rounded"></div>
            <span>{t("repeatCheckin")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span>{t("notFound")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
