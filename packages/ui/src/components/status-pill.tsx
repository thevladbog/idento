import {
  AlertCircle, CheckCircle2, Circle, CircleDashed, Loader2, Radio, type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";

export const STATUS_PILL_STATUSES = ["ready", "in_progress", "empty", "optional", "live", "error"] as const;
export type StatusPillStatus = (typeof STATUS_PILL_STATUSES)[number];

const config: Record<StatusPillStatus, { icon: LucideIcon; className: string }> = {
  ready: { icon: CheckCircle2, className: "border-transparent bg-success/10 text-success" },
  in_progress: { icon: Loader2, className: "border-transparent bg-warning/10 text-warning" },
  empty: { icon: Circle, className: "border-transparent bg-muted text-muted-foreground" },
  optional: { icon: CircleDashed, className: "border-dashed border-border text-muted-foreground" },
  live: { icon: Radio, className: "border-transparent bg-success text-success-foreground" },
  error: { icon: AlertCircle, className: "border-transparent bg-destructive/10 text-destructive" },
};

export interface StatusPillProps {
  status: StatusPillStatus;
  label: string;
  icon?: LucideIcon;
  className?: string;
}

export function StatusPill({ status, label, icon, className }: StatusPillProps) {
  const Icon = icon ?? config[status].icon;
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium",
        config[status].className,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}
