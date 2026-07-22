import { DesktopOnlyGate, type DesktopOnlyGateFlavor } from "@idento/ui";
import { Link, useParams } from "@tanstack/react-router";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../hooks/useIsMobile";

export interface DesktopOnlyProps {
  flavor: DesktopOnlyGateFlavor;
  titleKey: string;
  reasonKey: string;
  children: React.ReactNode;
}

// P6.1 — Tier-3 gating (board 8o/8s). A render swap on the SAME url, never
// a redirect: rotating a tablet past `md` re-evaluates useIsMobile and the
// real page appears in place. `children` stays an unrendered React element
// while the gate shows, so the gated page's queries/effects never run on a
// phone (the equipment hub's localhost-agent polling, the badge editor's
// font loading).
export function DesktopOnly({ flavor, titleKey, reasonKey, children }: DesktopOnlyProps) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const params = useParams({ strict: false }) as { eventId?: string };

  if (!isMobile) return <>{children}</>;

  return (
    <DesktopOnlyGate
      flavor={flavor}
      title={t(titleKey)}
      reason={t(reasonKey)}
      href={window.location.href}
      copyLabel={t("gateCopyLink")}
      copiedLabel={t("gateLinkCopied")}
      back={
        params.eventId ? (
          <Link to="/events/$eventId" params={{ eventId: params.eventId }} className="text-body font-medium text-success">
            {t("gateBackOverview")}
          </Link>
        ) : (
          <Link to="/" className="text-body font-medium text-success">
            {t("gateBackHome")}
          </Link>
        )
      }
    />
  );
}
