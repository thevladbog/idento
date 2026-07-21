import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { api } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";

export default function QRLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [qrToken, setQrToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/auth/login-qr", { qr_token: qrToken.trim() });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      navigate("/checkin");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(msg || t("invalidQRToken"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PreflightShell
      steps={steps}
      activeIndex={1}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-7">
        <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>
          {t("qrLogin")}
        </div>
        <KioskInput
          mono
          type="text"
          placeholder={t("enterQRToken")}
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
        />
        {error && <p className="text-kiosk-danger-soft">{error}</p>}
        <KioskButton type="submit" disabled={loading}>
          {loading ? "…" : t("qrLogin")}
        </KioskButton>
        <div className="flex justify-center gap-6 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          <Link to="/login" className="text-kiosk-brand hover:underline">
            {t("login")}
          </Link>
          <Link to="/connection" className="hover:text-kiosk-text">
            {t("serverUrl")}
          </Link>
        </div>
      </form>
    </PreflightShell>
  );
}
