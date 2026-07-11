import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { getImpersonation, endImpersonation, getParkedOperatorToken, type ImpersonationSession } from '@/lib/impersonation';
import { fetchImpersonationSummary, type ImpersonationSummary } from '@/lib/impersonationSummary';

/**
 * Unmissable support-session banner: shown on every page while an
 * impersonation token is active. Counts down; exiting shows a duration +
 * action-count summary before the operator confirms leaving (design
 * brief's impersonation-as-a-ceremony requirement).
 */
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [summary, setSummary] = useState<ImpersonationSummary | null>(null);

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

  const startExit = async () => {
    setExiting(true);
    const operatorToken = getParkedOperatorToken();
    if (!operatorToken) return; // no summary possible; dialog still shows the unavailable copy
    try {
      const result = await fetchImpersonationSummary(session.tenantId, session.mintedAt, operatorToken);
      setSummary(result);
    } catch {
      setSummary(null); // fail open: never block exit on a failed summary fetch
    }
  };

  return (
    <>
      <div className="sticky top-0 z-[60] flex h-10 items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
        <span>
          {t('impersonationBanner', { tenant: session.tenantName, minutes: minutesLeft })}
        </span>
        <Button size="sm" variant="outline" className="h-7 border-black/30 bg-transparent text-black hover:bg-black/10" onClick={startExit}>
          {t('impersonationExit')}
        </Button>
      </div>
      <Dialog open={exiting} onOpenChange={(open) => !open && setExiting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('td_exitSummaryTitle', { tenant: session.tenantName })}</DialogTitle>
            <DialogDescription>
              {summary
                ? t('td_exitSummaryBody', { minutes: summary.durationMinutes, count: summary.actionCount })
                : t('td_exitSummaryUnavailable')}
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="outline"
            onClick={() => endImpersonation(`/super-admin/organizations/${session.tenantId}#activity`)}
          >
            {t('td_exitSummaryViewActivity')}
          </Button>
          <DialogFooter>
            <Button onClick={() => endImpersonation()}>{t('impersonationExit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
