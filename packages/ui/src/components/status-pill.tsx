import {
  AlertCircle, CheckCircle2, Circle, CircleDashed, Loader2, Radio, type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";

export const STATUS_PILL_STATUSES = ["ready", "in_progress", "empty", "optional", "live", "error"] as const;
export type StatusPillStatus = (typeof STATUS_PILL_STATUSES)[number];

const config: Record<StatusPillStatus, { icon: LucideIcon; className: string; dotClassName: string }> = {
  ready: { icon: CheckCircle2, className: "border-transparent bg-success/10 text-success", dotClassName: "bg-success" },
  in_progress: { icon: Loader2, className: "border-transparent bg-warning/10 text-warning", dotClassName: "bg-warning" },
  empty: { icon: Circle, className: "border-transparent bg-muted text-muted-foreground", dotClassName: "bg-muted-foreground" },
  optional: {
    icon: CircleDashed,
    className: "border-dashed border-border text-muted-foreground",
    dotClassName: "bg-muted-foreground",
  },
  live: { icon: Radio, className: "border-transparent bg-success text-success-foreground", dotClassName: "bg-success-foreground" },
  error: { icon: AlertCircle, className: "border-transparent bg-destructive/10 text-destructive", dotClassName: "bg-destructive" },
};

export interface StatusPillProps {
  status: StatusPillStatus;
  label: string;
  icon?: LucideIcon;
  className?: string;
  // PR #81 bot round Finding C1: a "live connection" indicator (panel's
  // monitor header LIVE pill, LiveStrip's LIVE NOW badge) reads as a
  // colored pulsing dot, not an icon+label pair -- board 7e/1c's own
  // vocabulary, distinct from every other StatusPill consumer so far.
  // Additive, defaulted-off: every existing call site is unaffected.
  /** Renders a status-colored dot instead of the icon. Defaults to the icon. */
  indicator?: "icon" | "dot";
  /**
   * Only meaningful when `indicator="dot"` -- adds an animated "ping" ring
   * around the dot. The dot itself always renders under `indicator="dot"`;
   * only the ring is gated on this flag, so a caller can show a static dot
   * while e.g. "connecting" and switch on the ring only once truly live.
   */
  pulse?: boolean;
  /**
   * PR #81 round-2 convergence Finding 5: "pill" (default) is the original
   * API -- full badge chrome (border/background/padding) with `label`
   * always rendered as visible text next to the icon/dot. "bare" renders
   * ONLY a status-colored dot -- no chrome, no icon, no inline label -- for
   * a caller embedding a compact liveness dot in its OWN row layout
   * alongside a name and a SEPARATE, conditional text label (e.g.
   * StationsCard.tsx's per-station dot: green/fresh renders no text at all,
   * amber/stale renders its own "stale Ns" span elsewhere in the row).
   * `indicator` is ignored in this variant (bare is always a dot). `label`
   * stays required and is applied as `aria-label` on the root element, so
   * assistive tech still gets a description even though nothing is drawn.
   * `className` merges onto the root element, same as "pill".
   */
  variant?: "pill" | "bare";
}

export function StatusPill({
  status, label, icon, className, indicator = "icon", pulse = false, variant = "pill",
}: StatusPillProps) {
  const Icon = icon ?? config[status].icon;

  if (variant === "bare") {
    return (
      <span aria-label={label} className={cn("relative inline-flex shrink-0", className)}>
        {pulse ? (
          <span
            aria-hidden
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-75",
              config[status].dotClassName,
            )}
          />
        ) : null}
        <span aria-hidden className={cn("relative inline-flex size-2.5 rounded-full", config[status].dotClassName)} />
      </span>
    );
  }

  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium",
        config[status].className,
        className,
      )}
    >
      {indicator === "dot" ? (
        <span aria-hidden className="relative flex size-2 shrink-0">
          {pulse ? (
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                config[status].dotClassName,
              )}
            />
          ) : null}
          <span className={cn("relative inline-flex size-2 rounded-full", config[status].dotClassName)} />
        </span>
      ) : (
        <Icon aria-hidden className={cn("size-3.5 shrink-0", status === "in_progress" && "animate-spin")} />
      )}
      {label}
    </span>
  );
}
