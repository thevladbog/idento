import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";

// Board 8n — Tier-3 sections stay VISIBLE on phone with their desktop
// affiliation spelled out, never hidden and never a broken layout: each row
// navigates to the real route, which renders its DesktopOnlyGate below `md`
// (same URLs as desktop; deep links land the same way). P6.3 adds the
// "Event info (read-only)" and "Add station" rows above this group.
const EVENT_ITEMS = [
  { key: "badge", labelKey: "moreSheetBadge", to: "/events/$eventId/badge" },
  { key: "zones", labelKey: "moreSheetZones", to: "/events/$eventId/zones" },
  { key: "settings", labelKey: "moreSheetSettings", to: "/events/$eventId/settings" },
] as const;

export interface MoreSheetProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoreSheet({ eventId, open, onOpenChange }: MoreSheetProps) {
  const { t } = useTranslation();

  const desktopChip = (
    <span className="inline-flex flex-none items-center gap-1 text-caption text-muted-foreground">
      <Monitor aria-hidden className="size-3" />
      {t("moreSheetDesktopChip")}
    </span>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" closeLabel={t("moreSheetCloseLabel")}>
        <SheetHeader>
          <SheetTitle>{t("moreSheetTitle")}</SheetTitle>
        </SheetHeader>
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {t("moreSheetDesktopGroup")}
        </p>
        <nav className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {EVENT_ITEMS.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              params={{ eventId }}
              onClick={() => onOpenChange(false)}
              className="flex min-h-12 items-center gap-2 px-3.5 text-body hover:bg-muted"
            >
              <span className="flex-1">{t(item.labelKey)}</span>
              {desktopChip}
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            </Link>
          ))}
          <Link
            to="/equipment"
            onClick={() => onOpenChange(false)}
            className="flex min-h-12 items-center gap-2 px-3.5 text-body hover:bg-muted"
          >
            <span className="flex-1">{t("moreSheetEquipment")}</span>
            {desktopChip}
            <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
