import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell } from "@idento/ui/kiosk";
import { api, clearSession } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";
import { UpdateChip } from "@/components/UpdateChip";
import { toast } from "sonner";

type CheckinEvent = { id: string; name: string };

export default function CheckinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [events, setEvents] = useState<CheckinEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    setFetchError(false);
    api
      .get<CheckinEvent[]>("/api/events")
      .then((res: { data: CheckinEvent[] }) => setEvents(Array.isArray(res.data) ? res.data : []))
      .catch(() => {
        setFetchError(true);
        setEvents([]);
        toast.error(t("eventsFetchFailed"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <PreflightShell
      steps={steps}
      activeIndex={2}
      banner={<UpdateChip />}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
          <button type="button" className="text-kiosk-text-3 hover:text-kiosk-text" onClick={() => { clearSession(); navigate("/login"); }}>
            {t("logout")}
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="text-kiosk-text-3">{t("loadingEvents")}</p>
      ) : fetchError ? (
        <p className="text-kiosk-danger-soft">{t("eventsFetchFailedDesc")}</p>
      ) : events.length === 0 ? (
        <p className="text-kiosk-text-3">{t("noEventsDesc")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {events.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className="h-[320px] w-[500px] rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6 text-left hover:border-kiosk-brand"
              onClick={() => navigate(`/checkin/${ev.id}/equipment`)}
            >
              <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{ev.name}</div>
            </button>
          ))}
        </div>
      )}
    </PreflightShell>
  );
}
