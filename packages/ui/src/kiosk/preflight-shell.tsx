import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";

export interface PreflightShellProps {
  steps: { label: string }[];
  activeIndex: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  banner?: React.ReactNode;
  className?: string;
}

/** Хребет pre-flight (1r): рейка из 5 шагов, один активный, карточка 820px по центру. */
export function PreflightShell({ steps, activeIndex, children, footer, banner, className }: PreflightShellProps) {
  return (
    <div className={cn("relative flex h-full flex-col items-center bg-kiosk-bg text-kiosk-text", className)} style={{ fontFamily: "var(--kiosk-font)" }}>
      {banner && <div className="absolute right-8 top-8">{banner}</div>}
      <ol className="mt-[7vh] flex items-center gap-9 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        {steps.map((step, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li key={step.label} data-state={state} aria-current={state === "active" ? "step" : undefined} className={cn("flex items-center gap-3", state !== "pending" && "font-bold text-kiosk-text")}>
              {i > 0 && <span aria-hidden className="-ml-6 mr-3 h-0.5 w-14 bg-kiosk-border-2" />}
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full font-extrabold", state === "pending" ? "border-2 border-kiosk-border-2" : "bg-kiosk-brand text-kiosk-text")}>
                {state === "done" ? <Check aria-hidden className="size-5" strokeWidth={3.5} /> : i + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className="my-auto w-[min(820px,92vw)] rounded-3xl border border-kiosk-border bg-kiosk-surface p-14">{children}</div>
      {footer && (
        <div className="mb-12 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}
