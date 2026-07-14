import { Button } from "@idento/ui";
import { useTranslation } from "react-i18next";
import { clearSession } from "../../shared/api/session";

export function SuspendedScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-page-title">{t("tenantSuspendedTitle")}</h1>
        <p className="text-body text-muted-foreground">{t("tenantSuspendedBody")}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.assign("mailto:support@idento.io")}>
            {t("tenantSuspendedContactSupport")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              clearSession();
              window.location.assign("/login");
            }}
          >
            {t("tenantSuspendedSignOut")}
          </Button>
        </div>
      </div>
    </div>
  );
}
