import { Check, CircleAlert, Copy, Download, PenTool, Printer, type LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export type DesktopOnlyGateFlavor = "canvas-tool" | "agent-bound" | "bulk-data";

// Board 8o — flavor picks icon + tint AND implies the reason's register:
// the reason line names a physical constraint (canvas, local agent, bulk
// data), never "not supported".
const FLAVOR_ICON: Record<DesktopOnlyGateFlavor, { icon: LucideIcon; className: string }> = {
  "canvas-tool": { icon: PenTool, className: "bg-success/10 text-success" },
  "agent-bound": { icon: Printer, className: "bg-info/10 text-info" },
  "bulk-data": { icon: Download, className: "bg-warning/10 text-warning" },
};

export interface DesktopOnlyGateProps {
  flavor: DesktopOnlyGateFlavor;
  title: string;
  /** One honest line naming the physical constraint. */
  reason: string;
  /** Deep link copied for the desktop handover. */
  href: string;
  copyLabel: string;
  copiedLabel: string;
  /** Shown for 2 s when the clipboard write fails or the API is unavailable. */
  copyFailedLabel: string;
  /** Way back (the consumer's router link) — deep links never strand the user. */
  back?: React.ReactNode;
  className?: string;
}

export function DesktopOnlyGate({
  flavor, title, reason, href, copyLabel, copiedLabel, copyFailedLabel, back, className,
}: DesktopOnlyGateProps) {
  const { icon: Icon, className: iconClassName } = FLAVOR_ICON[flavor];
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");

  React.useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  return (
    <div className={cn("flex min-h-[60vh] flex-col items-center justify-center gap-1 p-6 text-center", className)}>
      <div className={cn("mb-3 flex size-12 items-center justify-center rounded-xl", iconClassName)}>
        <Icon aria-hidden className="size-6" />
      </div>
      <h2 className="text-section-title">{title}</h2>
      <p className="max-w-xs text-body text-muted-foreground">{reason}</p>
      <Button
        className="mt-4"
        onClick={() => {
          void (async () => {
            try {
              if (!navigator.clipboard) throw new Error("clipboard unavailable");
              await navigator.clipboard.writeText(href);
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
          })();
        }}
      >
        {copyState === "copied" ? (
          <Check aria-hidden className="size-4" />
        ) : copyState === "failed" ? (
          <CircleAlert aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        {copyState === "copied" ? copiedLabel : copyState === "failed" ? copyFailedLabel : copyLabel}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copyState === "copied" ? copiedLabel : copyState === "failed" ? copyFailedLabel : ""}
      </span>
      {back ? <div className="mt-2 flex min-h-11 items-center">{back}</div> : null}
    </div>
  );
}
