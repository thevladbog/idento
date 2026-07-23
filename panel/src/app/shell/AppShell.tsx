import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { OrgSwitcher } from "./OrgSwitcher";
import { NavDrawer } from "./NavDrawer";
import { ImpersonationBanner } from "../../features/impersonation/ImpersonationBanner";
import { LanguageSwitcher } from "../../shared/ui/LanguageSwitcher";
import { ThemeSwitcher } from "../../shared/ui/ThemeSwitcher";
import { useInstance } from "../../shared/api/useInstance";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const instance = useInstance();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ImpersonationBanner />
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:gap-4">
        <NavDrawer />
        <span className="flex items-center gap-2">
          <img src="/logo-mark.svg" alt="" aria-hidden="true" className="h-6 w-auto" />
          <span className="text-section-title">{t("appName")}</span>
        </span>
        <OrgSwitcher />
        {instance.data?.mode === "onprem" ? (
          <>
            {/* Hidden on phones: the header's min-content must fit 390px (P6.1
            acceptance — no horizontal overflow); the version tag is the most
            expendable item and returns at `sm`. */}
            <span className="hidden text-caption text-muted-foreground sm:inline">{t("onPremVersionTag", { version: instance.data.version })}</span>
          </>
        ) : null}
        <nav className="hidden items-center gap-4 md:flex">
          <Link to="/" activeOptions={{ exact: true }} className="text-body text-muted-foreground hover:text-foreground [&.active]:text-foreground">
            {t("navEvents")}
          </Link>
          <Link to="/team" className="text-body text-muted-foreground hover:text-foreground [&.active]:text-foreground">
            {t("navTeam")}
          </Link>
          <Link to="/equipment" className="text-body text-muted-foreground hover:text-foreground [&.active]:text-foreground">
            {t("navEquipment")}
          </Link>
          <Link to="/organization" className="text-body text-muted-foreground hover:text-foreground [&.active]:text-foreground">
            {t("navOrganization")}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
