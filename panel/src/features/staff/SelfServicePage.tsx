import { Button, QrDisplay } from "@idento/ui";
import { IdCard } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { $api } from "../../shared/api/query";
import { clearSession, getCurrentUser } from "../../shared/api/session";

// Board 8q — reachable by any authenticated user at /me, but scoped in
// intent to the `staff` role (admins/managers have the full panel). No
// route-level role redirect — this codebase gates by UI only (mirrors
// StaffPage.tsx's own isAdmin/canManage pattern), never a hard route block.
export function SelfServicePage() {
  const { t } = useTranslation();
  const user = getCurrentUser();
  const [qrOpen, setQrOpen] = React.useState(false);
  const generateToken = $api.useMutation("post", "/api/users/{id}/qr-token");

  if (!user) return null;

  if (qrOpen && generateToken.data) {
    return (
      <QrDisplay
        value={generateToken.data.qr_token}
        title={user.email}
        subtitle={t("selfServiceStaffLabel")}
        expiresAt={null}
        expiredLabel=""
        regenerateLabel={t("selfServiceShowMyQr")}
        closeLabel={t("moreSheetCloseLabel")}
        onClose={() => setQrOpen(false)}
        onRegenerate={() => generateToken.mutate({ params: { path: { id: user.id } } })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-card-title font-bold">{user.email}</div>
          <div className="text-caption text-muted-foreground">{t("selfServiceStaffLabel")}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            clearSession();
            window.location.assign("/login");
          }}
          className="text-caption font-semibold text-muted-foreground"
        >
          {t("selfServiceSignOut")}
        </button>
      </div>

      <Button
        className="gap-2"
        onClick={() => {
          generateToken.mutate(
            { params: { path: { id: user.id } } },
            { onSuccess: () => setQrOpen(true) },
          );
        }}
      >
        <IdCard aria-hidden className="size-4" />
        {t("selfServiceShowMyQr")}
      </Button>
      <p className="text-caption text-muted-foreground">{t("selfServiceScanningNote")}</p>
    </div>
  );
}
