import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { api } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePreflightSteps } from "@/features/preflight/steps";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const steps = usePreflightSteps();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      if (response.data.tenants) {
        localStorage.setItem("tenants", JSON.stringify(response.data.tenants));
      }
      if (response.data.current_tenant) {
        localStorage.setItem("current_tenant", JSON.stringify(response.data.current_tenant));
      }
      navigate("/checkin");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(msg || t("loginFailed"));
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
      <form onSubmit={onSubmit} className="flex flex-col gap-7">
        <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>
          {t("login")}
        </div>
        <div className="flex flex-col gap-4">
          <KioskInput
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <KioskInput
            type="password"
            placeholder={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-kiosk-danger-soft">{error}</p>}
        <KioskButton type="submit" disabled={loading}>
          {loading ? "…" : t("login")}
        </KioskButton>
        <div className="flex justify-center gap-6 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          <Link to="/qr-login" className="text-kiosk-brand hover:underline">
            {t("qrLogin")}
          </Link>
          <Link to="/connection" className="hover:text-kiosk-text">
            {t("serverUrl")}
          </Link>
        </div>
      </form>
    </PreflightShell>
  );
}
