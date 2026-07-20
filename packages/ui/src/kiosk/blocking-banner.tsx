import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface BlockingBannerProps {
  title: string;
  subtitle?: string;
  retryLabel: string;
  onRetry: () => void;
  retryHint?: string;
  className?: string;
}

/** Красный баннер блокировки (112px, var): занимает место статус-полосы, всегда с действием. */
export function BlockingBanner({ title, subtitle, retryLabel, onRetry, retryHint, className }: BlockingBannerProps) {
  return (
    <div role="alert" className={cn("flex shrink-0 items-center gap-6 bg-kiosk-danger px-9 text-kiosk-text", className)} style={{ height: "var(--kiosk-banner-h)", fontFamily: "var(--kiosk-font)" }}>
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-kiosk-overlay-ink">
        <X className="size-6" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-extrabold" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{title}</span>
        {subtitle && <span className="block truncate opacity-85" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{subtitle}</span>}
      </span>
      {retryHint && <span className="ml-auto shrink-0 opacity-85" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{retryHint}</span>}
      <button type="button" onClick={onRetry} className={cn("shrink-0 rounded-xl bg-kiosk-text px-7 py-3.5 font-extrabold text-kiosk-danger", !retryHint && "ml-auto")} style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>
        {retryLabel}
      </button>
    </div>
  );
}
