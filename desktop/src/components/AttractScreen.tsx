// Self-service idle screen (K2b): tenant brand slot + language toggle (the
// only interactive element) + a slow drift transform against screen
// burn-in. Rendered by SelfServicePage whenever the check-in loop is idle
// (no scan in flight, no verdict showing).
import { useEffect, useRef } from "react";
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
  const logoUrl = getTenantLogoUrl();
  const driftRef = useRef<HTMLDivElement>(null);

  // Writes the transform directly to the DOM instead of React state: this
  // node is idle for hours at a time on an unattended kiosk, and a
  // per-frame setState would re-render the whole subtree (including
  // BrandSlot/LanguageToggle) ~60x/sec purely to move a decorative drift.
  useEffect(() => {
    let raf: number;
    const start = Date.now();
    function tick() {
      const elapsed = (Date.now() - start) % DRIFT_CYCLE_MS;
      const angle = (elapsed / DRIFT_CYCLE_MS) * Math.PI * 2;
      if (driftRef.current) {
        driftRef.current.style.transform = `translate(${Math.cos(angle) * DRIFT_RANGE_PX}px, ${Math.sin(angle) * DRIFT_RANGE_PX}px)`;
      }
      raf = window.requestAnimationFrame(tick);
    }
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={driftRef} className="flex flex-col items-center gap-11">
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
