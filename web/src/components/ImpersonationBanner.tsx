import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { getImpersonation, endImpersonation, type ImpersonationSession } from '@/lib/impersonation';

/**
 * Unmissable support-session banner: shown on every page while an
 * impersonation token is active. Counts down and offers the only exit.
 */
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [minutesLeft, setMinutesLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const s = getImpersonation(); // self-cleans on expiry
      setSession(s);
      if (s) {
        setMinutesLeft(Math.max(0, Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 60000)));
        document.documentElement.style.setProperty('--imp-banner-h', '40px');
      } else {
        document.documentElement.style.setProperty('--imp-banner-h', '0px');
      }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => {
      clearInterval(id);
      document.documentElement.style.setProperty('--imp-banner-h', '0px');
    };
  }, []);

  if (!session) return null;

  return (
    <div className="sticky top-0 z-[60] flex h-10 items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
      <span>
        {t('impersonationBanner', { tenant: session.tenantName, minutes: minutesLeft })}
      </span>
      <Button size="sm" variant="outline" className="h-7 border-black/30 bg-transparent text-black hover:bg-black/10" onClick={endImpersonation}>
        {t('impersonationExit')}
      </Button>
    </div>
  );
}
