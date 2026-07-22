import { Check, Copy, Download, PenTool, Printer, type LucideIcon } from "lucide-react";
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
  /** Way back (the consumer's router link) — deep links never strand the user. */
  back?: React.ReactNode;
  className?: string;
}

export function DesktopOnlyGate({
  flavor, title, reason, href, copyLabel, copiedLabel, back, className,
}: DesktopOnlyGateProps) {
  const { icon: Icon, className: iconClassName } = FLAVOR_ICON[flavor];
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
          void navigator.clipboard?.writeText(href);
          setCopied(true);
        }}
      >
        {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        {copied ? copiedLabel : copyLabel}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
      {back ? <div className="mt-2 flex min-h-11 items-center">{back}</div> : null}
    </div>
  );
}
