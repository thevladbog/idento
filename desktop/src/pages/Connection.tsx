import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { getBackendUrl, setBackendUrl } from "@/lib/config";
import { api } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";
import { UpdateChip } from "@/components/UpdateChip";

export default function ConnectionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [url, setUrl] = useState(getBackendUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  const checkConnection = async () => {
    setStatus("checking");
    setMessage("");
    try {
      const base = url.trim().replace(/\/$/, "");
      const res = await fetch(`${base}/health`, { method: "GET" });
      if (res.ok) {
        setStatus("ok");
        setMessage(t("connected"));
      } else {
        setStatus("error");
        setMessage(`HTTP ${res.status}`);
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : t("connectionFailed"));
    }
  };

  const save = () => {
    const normalizedBase = url.trim().replace(/\/$/, "");
    setBackendUrl(normalizedBase);
    api.defaults.baseURL = normalizedBase;
    navigate("/login");
  };

  useEffect(() => {
    setUrl(getBackendUrl());
  }, []);

  return (
    <PreflightShell
      steps={steps}
      activeIndex={0}
      banner={<UpdateChip />}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <div className="flex flex-col gap-7">
        <div>
          <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>
            {t("serverUrl")}
          </div>
          <p className="mt-2 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>
            {t("serverUrlDesc")}
          </p>
        </div>
        <KioskInput
          mono
          type="url"
          placeholder={t("serverUrlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {status === "checking" && <p className="text-kiosk-text-3">{t("checking")}</p>}
        {status === "ok" && (
          <p className="flex items-center gap-2 font-semibold text-kiosk-ok">
            <span aria-hidden className="size-3 rounded-full bg-kiosk-ok" />
            {message}
          </p>
        )}
        {status === "error" && <p className="text-kiosk-danger-soft">{message}</p>}
        <div className="flex gap-4">
          <KioskButton variant="outline" onClick={checkConnection} disabled={status === "checking"}>
            {t("connect")}
          </KioskButton>
          <KioskButton onClick={save}>{t("saveAndGoToLoginShort")}</KioskButton>
          <KioskButton variant="ghost" onClick={() => navigate("/login")}>
            {t("cancel")}
          </KioskButton>
        </div>
      </div>
    </PreflightShell>
  );
}
