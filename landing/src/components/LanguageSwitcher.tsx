"use client";

import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";

const locales = [
  { value: "en", label: "EN" },
  { value: "ru", label: "RU" },
] as const;

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();

  const getHref = (nextLocale: string) => {
    const segments = pathname.split("/").filter(Boolean);
    const isLocaleSegment = locales.some((l) => l.value === segments[0]);
    const pathWithoutLocale = isLocaleSegment ? segments.slice(1) : segments;
    return ["", nextLocale, ...pathWithoutLocale].join("/") || `/${nextLocale}`;
  };

  return (
    <div className="flex items-center rounded-md border border-input bg-background">
      {locales.map((l) => (
        <a
          key={l.value}
          href={getHref(l.value)}
          className={`px-3 py-2 text-sm font-medium transition-colors first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            locale === l.value
              ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              : "text-muted-foreground"
          }`}
          aria-current={locale === l.value ? "page" : undefined}
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}
