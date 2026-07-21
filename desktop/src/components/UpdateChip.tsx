// Quiet update-availability chip: renders nothing when no update is
// available, so it's safe to mount on every pre-flight page (Task 4) --
// never shown on the Run screen, per the "run mode never interrupted"
// policy. Tap to review the version, then confirm to install (download +
// install + relaunch all happen inside install_update, see Task 1/2).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KioskButton } from "@idento/ui/kiosk";
import { useInstallUpdate, useUpdateCheck } from "@/features/updates/useUpdateCheck";

export function UpdateChip() {
  const { t } = useTranslation();
  const { data } = useUpdateCheck();
  const install = useInstallUpdate();
  const [confirming, setConfirming] = useState(false);

  if (!data?.available) return null;

  return (
    <div className="flex items-center gap-3 rounded-full border border-kiosk-border-2 bg-kiosk-surface-2 px-4 py-2 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
      <span>{t("updateAvailable", { version: data.version })}</span>
      {confirming ? (
        <>
          <KioskButton size="md" onClick={() => install.mutate()} disabled={install.isPending}>
            {t("updateInstall")}
          </KioskButton>
          <KioskButton size="md" variant="ghost" onClick={() => setConfirming(false)} disabled={install.isPending}>
            {t("cancel")}
          </KioskButton>
        </>
      ) : (
        <KioskButton size="md" variant="ghost" onClick={() => setConfirming(true)}>
          {t("updateReview")}
        </KioskButton>
      )}
    </div>
  );
}
