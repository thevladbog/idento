"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

export function Footer() {
  const _t = useTranslations("Navigation");

  return (
    <footer className="border-t bg-background">
      <div className="container flex flex-col items-center justify-between gap-4 py-10 md:h-24 md:flex-row md:py-0">
        <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built by{" "}
            <a
              href="https://idento.app"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Idento
            </a>
            . The source code is available on{" "}
            <a
              href="https://github.com/idento-app/idento"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4 transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            .
          </p>
        </div>
        <div className="flex gap-4">
          <Link
            href="/privacy"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  );
}
