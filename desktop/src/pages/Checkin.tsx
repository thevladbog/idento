import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QrCode, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, clearSession } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { toast } from "sonner";

type Event = { id: string; name: string };

export default function CheckinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    setFetchError(false);
    api
      .get<Event[]>("/api/events")
      .then((res: { data: Event[] }) => setEvents(Array.isArray(res.data) ? res.data : []))
      .catch(() => {
        setFetchError(true);
        setEvents([]);
        toast.error(t("eventsFetchFailed"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <div className="min-h-screen bg-background p-4">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold">{t("checkinInterface")}</h1>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button variant="outline" size="sm" onClick={() => navigate("/equipment")}>
            <Settings className="mr-1 h-4 w-4" />
            {t("equipment")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { clearSession(); navigate("/login"); }}>
            {t("logout")}
          </Button>
        </div>
      </header>

      {loading ? (
        <p className="text-muted-foreground">{t("loadingEvents")}</p>
      ) : fetchError ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">{t("eventsFetchFailed")}</CardTitle>
            <CardDescription>{t("eventsFetchFailedDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("noEvents")}</CardTitle>
            <CardDescription>{t("noEventsDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground">{t("checkinInterfaceDesc")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {events.map((ev) => (
              <Card key={ev.id} className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(`/checkin/${ev.id}`)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{ev.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button size="sm">
                    <QrCode className="mr-2 h-4 w-4" />
                    {t("startCheckin")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
