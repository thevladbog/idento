import { QrDisplay } from "@idento/ui";
import { LayoutGrid } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { $api } from "../../shared/api/query";
import { getCurrentUser } from "../../shared/api/session";

export interface AddStationActionProps {
  eventId: string;
  eventName: string;
}

// Board 8m — mints a station-provisioning token under the CURRENT
// organizer's own account (see the plan's design-decision note: the
// endpoint requires staff_user_id and board 8m shows no staff-picker
// step). Phone-only quick action; desktop provisions stations through
// its own existing flow (not built by this task).
export function AddStationAction({ eventId, eventName }: AddStationActionProps) {
  const { t } = useTranslation();
  const mint = $api.useMutation("post", "/api/events/{event_id}/stations/provisioning-token");
  // Cached separately from mint.data: onRegenerate calls mint.mutate() again
  // (the QrDisplay's own regenerate action), which resets the mutation to
  // pending -- gating render on mint.isSuccess/mint.data directly made the
  // whole QR screen flicker back to the base "Add station" button for that
  // window. The cached value stays on screen until the new token lands.
  const [cached, setCached] = React.useState<{ token: string; expiresAt: string } | null>(null);

  function mintToken() {
    const user = getCurrentUser();
    if (!user) return;
    mint.mutate(
      { params: { path: { event_id: eventId } }, body: { staff_user_id: user.id } },
      { onSuccess: (data) => setCached({ token: data.token, expiresAt: data.expires_at }) },
    );
  }

  if (cached) {
    return (
      <QrDisplay
        value={cached.token}
        title={t("addStationTitle")}
        subtitle={t("addStationQrSubtitle", { eventName })}
        expiresAt={cached.expiresAt}
        expiredLabel={t("addStationCodeExpired")}
        regenerateLabel={t("addStationTitle")}
        closeLabel={t("moreSheetCloseLabel")}
        onClose={() => {
          setCached(null);
          mint.reset();
        }}
        onRegenerate={mintToken}
        hint={t("addStationHint")}
      />
    );
  }

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={mintToken}
        className="flex min-h-13 w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 hover:bg-muted"
      >
        <span className="flex size-7.5 flex-none items-center justify-center rounded-md bg-success/10 text-success">
          <LayoutGrid aria-hidden className="size-4" />
        </span>
        <span className="flex-1 text-left text-body font-semibold">{t("addStationTitle")}</span>
        <span className="text-caption text-muted-foreground">{t("addStationSubtitle")}</span>
      </button>
      {mint.isError ? <p className="mt-2 text-caption text-destructive">{t("addStationError")}</p> : null}
    </div>
  );
}
