import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { useCheckinSettings, useSaveCheckinSettings } from "@/features/checkin/hooks";
import { usePreflightSteps } from "@/features/preflight/steps";
import { DEFAULT_CHECKIN_SETTINGS, type CheckinSettings } from "@/features/checkin/settingsTypes";
import { UpdateChip } from "@/components/UpdateChip";
import { getManifestUrlOverride, setManifestUrlOverride } from "@/lib/updateConfig";

export type RunLayout = "bar" | "panel";
export type StationType = "staffed" | "self";

const RUN_LAYOUT_KEY = "idento_run_layout";
const STATION_TYPE_KEY = "idento_station_type";

// eslint-disable-next-line react-refresh/only-export-components
export function loadRunLayout(): RunLayout {
  return localStorage.getItem(RUN_LAYOUT_KEY) === "panel" ? "panel" : "bar";
}

// eslint-disable-next-line react-refresh/only-export-components
export function loadStationType(): StationType {
  return localStorage.getItem(STATION_TYPE_KEY) === "self" ? "self" : "staffed";
}

export default function ModePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const steps = usePreflightSteps();
  const settingsQuery = useCheckinSettings(eventId!);
  const saveSettings = useSaveCheckinSettings(eventId!);

  const [layout, setLayout] = useState<RunLayout>(loadRunLayout);
  const [stationType, setStationType] = useState<StationType>(loadStationType);
  const [settings, setSettings] = useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);
  const [updateManifestUrl, setUpdateManifestUrl] = useState(() => getManifestUrlOverride());

  const selectStationType = (value: StationType) => {
    setStationType(value);
    // scan_input is an EVENT-wide setting (shared with any staffed station
    // on the same event) -- if it's currently "manual" when switching to
    // Self-service, sanitize it immediately rather than silently saving an
    // invalid-for-self-service combination.
    if (value === "self" && settings.scan_input === "manual") {
      setSettings((prev) => ({ ...prev, scan_input: "wedge" }));
    }
  };

  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);

  const saveAndStart = async () => {
    try {
      await saveSettings.mutateAsync(settings);
      localStorage.setItem(RUN_LAYOUT_KEY, layout);
      localStorage.setItem(STATION_TYPE_KEY, stationType);
      setManifestUrlOverride(updateManifestUrl);
      navigate(stationType === "self" ? `/checkin/${eventId}/self` : `/checkin/${eventId}`);
    } catch {
      toast.error(t("checkinSettingsSaveFailed"));
    }
  };

  const optionButtonClass = (active: boolean) =>
    active ? "border-kiosk-brand bg-kiosk-brand/10 text-kiosk-text" : "border-kiosk-border-2 text-kiosk-text-3";

  const scanInputOptions = stationType === "self" ? (["wedge", "scanner"] as const) : (["wedge", "scanner", "manual"] as const);

  return (
    <PreflightShell steps={steps} activeIndex={4} banner={<UpdateChip />}>
      {settingsQuery.isLoading ? (
        <p className="text-kiosk-text-3">{t("loading")}</p>
      ) : settingsQuery.isError ? (
        <p className="text-kiosk-danger-soft">{t("checkinFailed")}</p>
      ) : (
        <div className="flex flex-col gap-7">
          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeStationTypeTitle")}</div>
            <div className="mt-3 flex gap-3">
              {(["staffed", "self"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={stationType === value}
                  className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(stationType === value)}`}
                  onClick={() => selectStationType(value)}
                >
                  {value === "staffed" ? t("modeStationTypeStaffed") : t("modeStationTypeSelf")}
                </button>
              ))}
            </div>
          </div>

          {stationType === "staffed" && (
            <div>
              <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeLayoutTitle")}</div>
              <div className="mt-3 flex gap-3">
                {(["bar", "panel"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={layout === value}
                    className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(layout === value)}`}
                    onClick={() => setLayout(value)}
                  >
                    {value === "bar" ? t("modeLayoutBar") : t("modeLayoutPanel")}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="font-bold text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{t("modeScanInputTitle")}</div>
            <div className="mt-3 flex gap-3">
              {scanInputOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.scan_input === value}
                  className={`flex-1 rounded-xl border-2 p-4 text-left ${optionButtonClass(settings.scan_input === value)}`}
                  onClick={() => setSettings((prev) => ({ ...prev, scan_input: value }))}
                >
                  {value === "wedge" ? t("modeScanInputWedge") : value === "scanner" ? t("modeScanInputScanner") : t("modeScanInputManual")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-kiosk-text">{t("modePrintTitle")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.print_on_checkin}
              className={`h-8 w-14 rounded-full transition-colors ${settings.print_on_checkin ? "bg-kiosk-brand" : "bg-kiosk-border-2"}`}
              onClick={() => setSettings((prev) => ({ ...prev, print_on_checkin: !prev.print_on_checkin }))}
            >
              <span className={`block size-6 rounded-full bg-kiosk-text transition-transform ${settings.print_on_checkin ? "translate-x-7" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-kiosk-text">{t("modeManualSearchTitle")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.manual_search_enabled}
              className={`h-8 w-14 rounded-full transition-colors ${settings.manual_search_enabled ? "bg-kiosk-brand" : "bg-kiosk-border-2"}`}
              onClick={() => setSettings((prev) => ({ ...prev, manual_search_enabled: !prev.manual_search_enabled }))}
            >
              <span className={`block size-6 rounded-full bg-kiosk-text transition-transform ${settings.manual_search_enabled ? "translate-x-7" : "translate-x-1"}`} />
            </button>
          </div>

          <div>
            <span className="text-kiosk-text">
              {t("modeDismissTitle")}: {settings.verdict_auto_dismiss_sec}
            </span>
            <input
              type="range"
              min={1}
              max={30}
              value={settings.verdict_auto_dismiss_sec}
              onChange={(e) => setSettings((prev) => ({ ...prev, verdict_auto_dismiss_sec: Number(e.target.value) }))}
              className="mt-2 w-full"
            />
          </div>

          <div>
            <label htmlFor="update-manifest-url" className="text-kiosk-text">
              {t("modeUpdateManifestUrlTitle")}
            </label>
            <KioskInput
              id="update-manifest-url"
              placeholder={t("modeUpdateManifestUrlPlaceholder")}
              value={updateManifestUrl}
              onChange={(e) => setUpdateManifestUrl(e.target.value)}
              className="mt-2"
            />
          </div>

          <KioskButton onClick={saveAndStart} disabled={saveSettings.isPending}>
            {t("modeSaveAndStart")}
          </KioskButton>
        </div>
      )}
    </PreflightShell>
  );
}
