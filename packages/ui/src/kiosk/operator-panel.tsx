import { TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import { RecentLog, type RecentLogEntry } from "./recent-log";
import type { KioskNode } from "./station-status";

export interface OperatorPanelProps {
  eventName: string;
  locationLabel?: string;
  modeLabel?: string;
  nodes: KioskNode[];
  counterValue: number;
  counterLabel: string;
  log: RecentLogEntry[];
  className?: string;
}

function NodeRow({ node }: { node: KioskNode }) {
  if (node.level === "ok") {
    return (
      <div className="flex items-center gap-3.5 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        <span aria-hidden className={cn("size-3 rounded-full bg-kiosk-ok", node.live && "animate-[kiosk-pulse_2s_infinite]")} />
        {node.label}
        {node.detail && <span className="ml-auto text-kiosk-text-4">{node.detail}</span>}
      </div>
    );
  }
  const warn = node.level === "warn";
  const Icon = warn ? TriangleAlert : X;
  return (
    <div data-level={node.level} className={cn("flex items-start gap-3 rounded-xl p-4 font-bold", warn ? "bg-kiosk-warn text-kiosk-warn-ink" : "bg-kiosk-danger text-kiosk-text")} style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
      <Icon aria-hidden className="mt-0.5 size-[1.1em] shrink-0" />
      <span>
        {node.label}
        {node.detail && <span className="block font-semibold opacity-90">{node.detail}</span>}
      </span>
    </div>
  );
}

/** Компоновка 1c: постоянная панель оператора слева (440px, var), тёмная при любом вердикте. */
export function OperatorPanel({ eventName, locationLabel, modeLabel, nodes, counterValue, counterLabel, log, className }: OperatorPanelProps) {
  return (
    <aside className={cn("flex shrink-0 flex-col border-r border-kiosk-border bg-kiosk-surface px-9 py-10 text-kiosk-text", className)} style={{ width: "var(--kiosk-panel-w)", fontFamily: "var(--kiosk-font)" }}>
      <div className="font-extrabold leading-tight tracking-tight" style={{ fontSize: "calc(var(--kiosk-fs-chrome-lg) * 1.33)" }}>{eventName}</div>
      {locationLabel && <div className="mt-2 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{locationLabel}</div>}
      {modeLabel && (
        <div className="mt-5 self-start rounded-xl border border-kiosk-border-2 bg-kiosk-surface-2 px-4 py-3 font-semibold text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {modeLabel}
        </div>
      )}
      <div className="mt-11 flex flex-col gap-4">
        {nodes.map((n) => <NodeRow key={n.id} node={n} />)}
      </div>
      <div className="mt-auto">
        <div className="font-extrabold leading-none tracking-tighter" style={{ fontSize: "calc(var(--kiosk-fs-verdict-name) * 0.72)" }}>{counterValue}</div>
        <div className="mt-1.5 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{counterLabel}</div>
        <RecentLog entries={log} layout="panel" className="mt-7" />
      </div>
    </aside>
  );
}
