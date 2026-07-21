import { TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import type { KioskNode } from "./station-status";

export interface StatusChipProps {
  node: KioskNode;
  className?: string;
}

/** Чип 1e: ok — тихая точка с подписью; warn — янтарная пилюля; error — красная. */
export function StatusChip({ node, className }: StatusChipProps) {
  const text = node.detail && node.level !== "ok" ? `${node.label}: ${node.detail}` : node.label;

  if (node.level === "ok") {
    return (
      <span data-level="ok" className={cn("flex items-center gap-2.5 text-kiosk-text-3", node.live && "font-semibold text-kiosk-text", className)} style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        <span aria-hidden className={cn("size-3 rounded-full bg-kiosk-ok", node.live && "animate-[kiosk-pulse_2s_infinite]")} />
        {text}
      </span>
    );
  }

  const warn = node.level === "warn";
  const Icon = warn ? TriangleAlert : X;
  return (
    <span
      data-level={node.level}
      className={cn("flex items-center gap-2.5 rounded-full px-4 py-2 font-bold", warn ? "bg-kiosk-warn text-kiosk-warn-ink" : "bg-kiosk-danger text-kiosk-text", className)}
      style={{ fontSize: "var(--kiosk-fs-chrome)" }}
    >
      <Icon aria-hidden className="size-[1.1em] shrink-0" />
      {text}
    </span>
  );
}
