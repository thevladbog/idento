import { Check, CircleHelp, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import type { Verdict } from "../lib/verdict";

export interface RecentLogEntry {
  time: string;
  name: string;
  outcome: Verdict;
}

export interface RecentLogProps {
  title?: string;
  entries: RecentLogEntry[];
  layout?: "bar" | "panel";
  trailing?: string;
  className?: string;
}

const OUTCOME_ICON: Record<Verdict, { Icon: typeof Check; cls: string }> = {
  allowed: { Icon: Check, cls: "text-kiosk-ok" },
  already_checked_in: { Icon: TriangleAlert, cls: "text-kiosk-warn" },
  not_registered: { Icon: CircleHelp, cls: "text-kiosk-text-3" },
  no_access: { Icon: X, cls: "text-kiosk-danger-soft" },
};

function Row({ entry, layout }: { entry: RecentLogEntry; layout: "bar" | "panel" }) {
  const { Icon, cls } = OUTCOME_ICON[entry.outcome];
  return (
    <span className="flex min-w-0 items-center gap-3 text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
      <span className="shrink-0 text-kiosk-text-4 tabular-nums">{entry.time}</span>
      <span className={cn(layout === "panel" && "truncate")}>{entry.name}</span>
      <Icon aria-hidden className={cn("size-[1.1em] shrink-0 font-bold", cls, layout === "panel" && "ml-auto")} strokeWidth={3} />
    </span>
  );
}

/** Лог последних отметок: bar — футер 88px (1a), panel — колонка в панели оператора (1c). */
export function RecentLog({ title, entries, layout = "bar", trailing, className }: RecentLogProps) {
  if (layout === "panel") {
    return (
      <div className={cn("flex flex-col gap-3 border-t border-kiosk-border pt-6", className)}>
        {entries.map((e, i) => <Row key={i} entry={e} layout="panel" />)}
      </div>
    );
  }
  return (
    <footer className={cn("flex shrink-0 items-center gap-10 border-t border-kiosk-border px-9", className)} style={{ height: "var(--kiosk-footer-h)", fontFamily: "var(--kiosk-font)" }}>
      {title && <span className="font-semibold tracking-[.06em] text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{title}</span>}
      {entries.map((e, i) => <Row key={i} entry={e} layout="bar" />)}
      {trailing && <span className="ml-auto font-semibold text-kiosk-warn-text" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{trailing}</span>}
    </footer>
  );
}
