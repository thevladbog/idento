"use client";

import * as React from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Header() {
  const t = useTranslations("Navigation");
  const [isOpen, setIsOpen] = React.useState(false);

  const navItems = [
    { href: "#features", label: t("features"), isAnchor: true },
    { href: "#pricing", label: t("pricing"), isAnchor: true },
    { href: "#faq", label: t("faq"), isAnchor: true },
    { href: "https://docs.idento.app", label: t("docs"), external: true },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2 transition-opacity hover:opacity-80">
            <Image src="/logo-mark.svg" alt="" aria-hidden width={24} height={24} className="h-6 w-auto" unoptimized />
            <span className="hidden font-bold sm:inline-block">Idento</span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            {navItems.map((item) => {
              if (item.isAnchor) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className="text-foreground/70 transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </a>
                );
              }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-foreground/70 transition-colors hover:text-foreground"
                    target={item.external ? "_blank" : undefined}
                  >
                    {item.label}
                  </Link>
                );
            })}
          </nav>
        </div>
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              className="mr-2 px-0 text-base hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:hidden"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="pr-0">
            <Link
              href="/"
              className="flex items-center"
              onClick={() => setIsOpen(false)}
            >
              <Image src="/logo-mark.svg" alt="" aria-hidden width={24} height={24} className="h-6 w-auto" unoptimized />
              <span className="font-bold">Idento</span>
            </Link>
            <div className="my-4 h-[calc(100vh-8rem)] pb-10 pl-6">
              <div className="flex flex-col space-y-3">
                {navItems.map((item) => {
                  if (item.isAnchor) {
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className="block py-2 text-foreground/70 transition-colors hover:text-foreground hover:underline"
                      >
                        {item.label}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className="block py-2 text-foreground/70 transition-colors hover:text-foreground hover:underline"
                      target={item.external ? "_blank" : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            {/* Add search or other controls here if needed */}
          </div>
          <nav className="flex items-center space-x-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </nav>
        </div>
      </div>
    </header>
  );
}
