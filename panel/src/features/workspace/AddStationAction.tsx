import {
  Label, QrDisplay, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@idento/ui";
import { LayoutGrid } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { $api } from "../../shared/api/query";
import { useEventStaff } from "../staff/hooks";

export interface AddStationActionProps {
  eventId: string;
  eventName: string;
}

export function AddStationAction({ eventId, eventName }: AddStationActionProps) {
  const { t } = useTranslation();
  const staffQuery = useEventStaff(eventId);
  const [selectedStaffUserId, setSelectedStaffUserId] = React.useState("");
  const eligibleStaff = React.useMemo(
    () => (staffQuery.data ?? []).filter((user) => user.role === "staff" || user.role === "manager"),
    [staffQuery.data],
  );
  const selectedStaff = eligibleStaff.find((user) => user.id === selectedStaffUserId);
  const staffInitialError = staffQuery.isError && !staffQuery.data;
  const mint = $api.useMutation("post", "/api/events/{event_id}/stations/provisioning-token");
  // Cached separately from mint.data: onRegenerate calls mint.mutate() again
  // (the QrDisplay's own regenerate action), which resets the mutation to
  // pending -- gating render on mint.isSuccess/mint.data directly made the
  // whole QR screen flicker back to the base "Add station" button for that
  // window. The cached value stays on screen until the new token lands.
  const [cached, setCached] = React.useState<{ token: string; expiresAt: string } | null>(null);
  const [mintFailed, setMintFailed] = React.useState(false);
  const qrSessionRef = React.useRef(0);
  const mintInFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (selectedStaffUserId && !selectedStaff) setSelectedStaffUserId("");
  }, [selectedStaff, selectedStaffUserId]);

  function mintToken(openNewSession = false) {
    if (!selectedStaff || mintInFlightRef.current) return;
    if (openNewSession) {
      qrSessionRef.current += 1;
      setMintFailed(false);
    }
    const session = qrSessionRef.current;
    mintInFlightRef.current = true;
    mint.mutate(
      { params: { path: { event_id: eventId } }, body: { staff_user_id: selectedStaff.id } },
      {
        onSuccess: (data) => {
          if (session !== qrSessionRef.current) return;
          setMintFailed(false);
          setCached({ token: data.token, expiresAt: data.expires_at });
        },
        onError: () => {
          if (session === qrSessionRef.current) setMintFailed(true);
        },
        onSettled: () => {
          mintInFlightRef.current = false;
        },
      },
    );
  }

  function closeQrSession() {
    qrSessionRef.current += 1;
    setCached(null);
    setMintFailed(false);
  }

  if (cached) {
    return (
      <QrDisplay
        value={cached.token}
        title={t("addStationTitle")}
        subtitle={t("addStationQrSubtitle", { eventName })}
        codeLabel={t("qrDisplayCodeLabel")}
        expiresInLabel={t("qrDisplayExpiresIn")}
        expiresAt={cached.expiresAt}
        expiredLabel={t("addStationCodeExpired")}
        regenerateLabel={t("addStationTitle")}
        closeLabel={t("moreSheetCloseLabel")}
        onClose={closeQrSession}
        onRegenerate={() => mintToken()}
        isRegenerating={mint.isPending || !selectedStaff}
        hint={t("addStationHint")}
      />
    );
  }

  return (
    <div className="md:hidden">
      <div className="mb-3 space-y-1.5">
        <Label htmlFor="station-assignee">{t("addStationAssigneeLabel")}</Label>
        {staffQuery.isLoading ? (
          <p role="status" className="text-caption text-muted-foreground">{t("addStationAssigneeLoading")}</p>
        ) : staffInitialError ? (
          <p role="alert" className="text-caption text-destructive">{t("addStationAssigneeError")}</p>
        ) : eligibleStaff.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("addStationAssigneeEmpty")}</p>
        ) : (
          <Select value={selectedStaff?.id ?? ""} onValueChange={setSelectedStaffUserId}>
            <SelectTrigger id="station-assignee" className="min-h-11">
              <SelectValue placeholder={t("addStationAssigneePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {eligibleStaff.map((user) => (
                <SelectItem key={user.id} value={user.id} className="min-h-11">
                  {user.email} · {t(user.role === "manager" ? "staffRoleManager" : "staffRoleStaff")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <button
        type="button"
        disabled={!selectedStaff || mint.isPending}
        onClick={() => mintToken(true)}
        className="flex min-h-13 w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 hover:bg-muted"
      >
        <span className="flex size-7.5 flex-none items-center justify-center rounded-md bg-success/10 text-success">
          <LayoutGrid aria-hidden className="size-4" />
        </span>
        <span className="flex-1 text-left text-body font-semibold">{t("addStationTitle")}</span>
        <span className="text-caption text-muted-foreground">{t("addStationSubtitle")}</span>
      </button>
      {mintFailed ? <p className="mt-2 text-caption text-destructive">{t("addStationError")}</p> : null}
    </div>
  );
}
