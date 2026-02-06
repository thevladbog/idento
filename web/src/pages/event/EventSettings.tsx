import { useState, useEffect } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APIKeysManager } from "@/components/APIKeysManager";
import { FontManager } from "@/components/FontManager";
import {
  renderMarkdownTemplate,
  getDefaultAttendeeTemplate,
} from "@/utils/markdownTemplate";
import api from "@/lib/api";
import type { Event, Attendee } from "@/types";
import { Save, Eye, HelpCircle } from "lucide-react";
import { toast } from "sonner";

interface EventContext {
  event: Event | null;
  reloadEvent: () => void;
}

export default function EventSettings() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { event, reloadEvent } = useOutletContext<EventContext>();
  const [isSaving, setIsSaving] = useState(false);
  const [badgeTypeField, setBadgeTypeField] = useState<string>("");
  const [attendeeTemplate, setAttendeeTemplate] = useState<string>(
    getDefaultAttendeeTemplate()
  );
  const [sampleAttendee, setSampleAttendee] = useState<Attendee | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    start_date: "",
    end_date: "",
    location: "",
  });

  useEffect(() => {
    if (event) {
      setFormData({
        name: event.name,
        start_date: event.start_date ? event.start_date.split("T")[0] : "",
        end_date: event.end_date ? event.end_date.split("T")[0] : "",
        location: event.location || "",
      });
      setBadgeTypeField(String(event.custom_fields?.badgeTypeField ?? ""));
      setAttendeeTemplate(
        String(event.custom_fields?.attendeeTemplate ?? getDefaultAttendeeTemplate())
      );

      // Load first attendee for preview
      loadSampleAttendee();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when event changes
  }, [event]);

  const loadSampleAttendee = async () => {
    if (!eventId) return;
    try {
      const response = await api.get<Attendee[]>(
        `/api/events/${eventId}/attendees`
      );
      if (response.data && response.data.length > 0) {
        setSampleAttendee(response.data[0]);
      }
    } catch (error) {
      console.error("Failed to load sample attendee", error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/api/events/${eventId}`, {
        ...event,
        ...formData,
        start_date: formData.start_date
          ? new Date(formData.start_date).toISOString()
          : null,
        end_date: formData.end_date
          ? new Date(formData.end_date).toISOString()
          : null,
        custom_fields: {
          ...event?.custom_fields,
          badgeTypeField: badgeTypeField || undefined,
          attendeeTemplate: attendeeTemplate || undefined,
        },
      });
      toast.success(t("settingsSaved"));
      reloadEvent();
    } catch (error) {
      console.error("Failed to save settings", error);
      toast.error(t("failedToSaveSettings"));
    } finally {
      setIsSaving(false);
    }
  };

  const insertField = (field: string) => {
    setAttendeeTemplate((prev) => prev + `{${field}}`);
  };

  const getPreviewData = (): Record<string, unknown> => {
    if (!sampleAttendee) {
      return {
        first_name: "John",
        last_name: "Doe",
        email: "john.doe@example.com",
        company: "Acme Corporation",
        position: "CEO",
        code: "ABC123",
      };
    }

    return {
      first_name: sampleAttendee.first_name,
      last_name: sampleAttendee.last_name,
      email: sampleAttendee.email,
      company: sampleAttendee.company,
      position: sampleAttendee.position,
      code: sampleAttendee.code,
      ...(sampleAttendee.custom_fields || {}),
    };
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold">{t("eventSettings")}</h2>
        <p className="text-muted-foreground">{t("eventSettingsDesc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("basicInformation")}</CardTitle>
          <CardDescription>{t("basicInformationDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">{t("eventName")}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start_date">{t("startDate")}</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) =>
                  setFormData({ ...formData, start_date: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="end_date">{t("endDate")}</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.end_date}
                onChange={(e) =>
                  setFormData({ ...formData, end_date: e.target.value })
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="location">{t("location")}</Label>
            <Input
              id="location"
              value={formData.location}
              onChange={(e) =>
                setFormData({ ...formData, location: e.target.value })
              }
              placeholder={t("locationPlaceholder")}
            />
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? t("saving") : t("saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("checkinSettings")}</CardTitle>
          <CardDescription>{t("checkinSettingsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="badgeTypeField">{t("badgeTypeField")}</Label>
            <Select
              value={badgeTypeField || "__none__"}
              onValueChange={(value) =>
                setBadgeTypeField(value === "__none__" ? "" : value)
              }
            >
              <SelectTrigger id="badgeTypeField">
                <SelectValue placeholder={t("selectBadgeTypeField")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("none")}</SelectItem>
                {event?.field_schema &&
                  event.field_schema.map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {t("badgeTypeFieldDesc")}
            </p>
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? t("saving") : t("saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("attendeeDisplayTemplate")}</CardTitle>
              <CardDescription>
                {t("attendeeDisplayTemplateDesc")}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHelp(!showHelp)}
            >
              <HelpCircle className="mr-2 h-4 w-4" />
              {t("help")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showHelp && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-3 text-sm border">
              <div>
                <p className="font-semibold mb-2 text-base">
                  {t("markdownSyntax")}:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <code className="bg-background px-2 py-1 rounded text-xs font-mono">
                      **{"{field}"}**
                    </code>
                    <span className="text-xs text-muted-foreground">
                      — {t("boldText")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="bg-background px-2 py-1 rounded text-xs font-mono">
                      *{"{field}"}*
                    </code>
                    <span className="text-xs text-muted-foreground">
                      — {t("italicText")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="bg-background px-2 py-1 rounded text-xs font-mono">
                      # {"{field}"}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      — {t("heading1")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="bg-background px-2 py-1 rounded text-xs font-mono">
                      ## {"{field}"}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      — {t("heading2")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="bg-background px-2 py-1 rounded text-xs font-mono">
                      ### {"{field}"}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      — {t("heading3")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 col-span-2">
                    <span className="text-xs text-muted-foreground">
                      {t("twoSpacesForNewLine")}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <p className="font-semibold mb-2 text-base">
                  {t("availableFields")}:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {event?.field_schema?.map((field) => (
                    <Button
                      key={field}
                      variant="outline"
                      size="sm"
                      onClick={() => insertField(field)}
                      className="h-7 px-2 text-xs font-mono hover:bg-primary hover:text-primary-foreground"
                    >
                      {"{" + field + "}"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="attendee-template">{t("template")}</Label>
              <Textarea
                id="attendee-template"
                value={attendeeTemplate}
                onChange={(e) => setAttendeeTemplate(e.target.value)}
                placeholder={getDefaultAttendeeTemplate()}
                className="font-mono text-sm min-h-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                {t("useMarkdownAndFields")}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <Label>{t("preview")}</Label>
                {sampleAttendee && (
                  <span className="text-xs text-muted-foreground">
                    ({t("realData")}: {sampleAttendee.first_name}{" "}
                    {sampleAttendee.last_name})
                  </span>
                )}
              </div>
              <div className="border rounded-md p-6 min-h-[200px] bg-muted/30">
                <div className="markdown-preview">
                  <ReactMarkdown>
                    {renderMarkdownTemplate(attendeeTemplate, getPreviewData())}
                  </ReactMarkdown>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {sampleAttendee
                  ? t("previewWithRealData")
                  : t("previewWithExampleData")}
              </p>
            </div>
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? t("saving") : t("saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* API Keys Section */}
      {eventId && <APIKeysManager eventId={eventId} />}

      {/* Custom Fonts Section */}
      {eventId && <FontManager eventId={eventId} />}

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t("dangerZone")}</CardTitle>
          <CardDescription>{t("dangerZoneDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled>
            {t("deleteEvent")}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            {t("deleteEventWarning")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
