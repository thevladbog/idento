import { cn } from "../lib/cn";
import type { KioskNode } from "./station-status";
import { StatusChip } from "./status-chip";

export interface TopStatusBarProps {
  eventName: string;
  locationLabel?: string;
  modeLabel?: string;
  nodes: KioskNode[];
  counterLabel: string;
  counterValue: number;
  clock?: string;
  className?: string;
}

/** Компоновка 1a: статус-полоса сверху, 76px (var), «зелёная тишина». */
export function TopStatusBar({ eventName, locationLabel, modeLabel, nodes, counterLabel, counterValue, clock, className }: TopStatusBarProps) {
  return (
    <header
      className={cn("flex shrink-0 items-center gap-5 border-b border-kiosk-border bg-kiosk-surface px-9 text-kiosk-text", className)}
      style={{ height: "var(--kiosk-bar-h)", fontFamily: "var(--kiosk-font)" }}
    >
      <div className="font-bold" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{eventName}</div>
      {locationLabel && <div className="text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{locationLabel}</div>}
      {modeLabel && (
        <div className="rounded-full border border-kiosk-border-2 bg-kiosk-surface-2 px-4 py-1.5 font-semibold text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {modeLabel}
        </div>
      )}
      <div className="ml-auto flex items-center gap-6">
        {nodes.map((n) => <StatusChip key={n.id} node={n} />)}
        <span aria-hidden className="h-8 w-px bg-kiosk-border-2" />
        <span className="text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {counterLabel}&nbsp;<b className="text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{counterValue}</b>
        </span>
        {clock && <span className="text-kiosk-text-4 tabular-nums" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{clock}</span>}
      </div>
    </header>
  );
}
