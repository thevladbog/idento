import { Button } from "@idento/ui";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { endImpersonation, getImpersonation, type ImpersonationSession } from "./impersonationSession";

export function ImpersonationBanner() {
  const { t } = useTranslation();
  const [session, setSession] = React.useState<ImpersonationSession | null>(null);
  const [minutesLeft, setMinutesLeft] = React.useState(0);

  React.useEffect(() => {
    const tick = () => {
      const s = getImpersonation();
      setSession(s);
      if (s) setMinutesLeft(Math.max(0, Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 60000)));
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  return (
    <div className="flex h-10 items-center justify-center gap-3 bg-warning px-4 text-body font-medium text-warning-foreground">
      <span>{t("impersonationBanner", { tenant: session.tenantName, minutes: minutesLeft })}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-warning-foreground/30 bg-transparent text-warning-foreground hover:bg-warning-foreground/10"
        onClick={() => {
          endImpersonation();
          window.location.reload();
        }}
      >
        {t("impersonationExit")}
      </Button>
    </div>
  );
}
