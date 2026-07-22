// Self-service idle screen (K2b): tenant brand slot + language toggle (the
// only interactive element) + a slow drift transform against screen
// burn-in. Rendered by SelfServicePage whenever the check-in loop is idle
// (no scan in flight, no verdict showing).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandSlot, LanguageToggle } from "@idento/ui/kiosk";
import { getTenantLogoUrl } from "@/lib/tenantBranding";

const DRIFT_CYCLE_MS = 60_000;
const DRIFT_RANGE_PX = 24;

const LANGUAGE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "ru", label: "RU" },
];

export function AttractScreen() {
  const { t, i18n } = useTranslation();
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  const logoUrl = getTenantLogoUrl();

  useEffect(() => {
    let raf: number;
    const start = Date.now();
    function tick() {
      const elapsed = (Date.now() - start) % DRIFT_CYCLE_MS;
      const angle = (elapsed / DRIFT_CYCLE_MS) * Math.PI * 2;
      setDrift({ x: Math.cos(angle) * DRIFT_RANGE_PX, y: Math.sin(angle) * DRIFT_RANGE_PX });
      raf = window.requestAnimationFrame(tick);
    }
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-11" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
      {logoUrl ? <BrandSlot src={logoUrl} alt={t("appName")} /> : <BrandSlot />}
      <div className="kiosk-type-idle-title text-kiosk-text">{t("selfAttractTitle")}</div>
      <LanguageToggle
        value={i18n.language?.slice(0, 2) ?? "en"}
        options={LANGUAGE_OPTIONS}
        onChange={(lang) => void i18n.changeLanguage(lang)}
      />
    </div>
  );
}
