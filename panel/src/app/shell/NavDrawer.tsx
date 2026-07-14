import {
  Button, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

export function NavDrawer() {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("navDrawerMenuLabel")}>
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" closeLabel={t("navDrawerCloseLabel")}>
        <SheetHeader>
          <SheetTitle>{t("appName")}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1">
          <Link to="/" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-body hover:bg-muted">
            {t("navEvents")}
          </Link>
          <Link to="/team" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-body hover:bg-muted">
            {t("navTeam")}
          </Link>
          <Link to="/equipment" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-body hover:bg-muted">
            {t("navEquipment")}
          </Link>
          <Link to="/organization" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-body hover:bg-muted">
            {t("navOrganization")}
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
