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
  // Cached separately from generateToken.data: calling .mutate() again (the
  // QrDisplay's own onRegenerate) resets the mutation to pending, so
  // generateToken.data goes briefly undefined mid-regenerate. Gating render
  // on the raw mutation state made the whole QR screen flicker back to the
  // base page (email/sign-out/button) for that window; the cached value
  // stays put until the new token actually lands.
  const [cachedToken, setCachedToken] = React.useState<string | null>(null);
  const generateToken = $api.useMutation("post", "/api/users/{id}/qr-token");

  if (!user) return null;

  function mintToken() {
    generateToken.mutate(
      { params: { path: { id: user!.id } } },
      {
        onSuccess: (data) => {
          setCachedToken(data.qr_token);
          setQrOpen(true);
        },
      },
    );
  }

  if (qrOpen && cachedToken) {
    return (
      <QrDisplay
        value={cachedToken}
        title={user.email}
        subtitle={t("selfServiceStaffLabel")}
        expiresAt={null}
        expiredLabel=""
        regenerateLabel={t("selfServiceShowMyQr")}
        closeLabel={t("moreSheetCloseLabel")}
        onClose={() => setQrOpen(false)}
        onRegenerate={mintToken}
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

      <Button className="gap-2" onClick={mintToken}>
        <IdCard aria-hidden className="size-4" />
        {t("selfServiceShowMyQr")}
      </Button>
      <p className="text-caption text-muted-foreground">{t("selfServiceScanningNote")}</p>
    </div>
  );
}
