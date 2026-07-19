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
   * ONLY a status-colored dot plus its accessible label -- no chrome, no
   * icon -- for a caller embedding a compact liveness dot in its OWN row
   * layout alongside a name and (per PR #81 round-3 convergence, UI
   * Finding 4) its OWN separately-composed visible status text.
   * `indicator` is ignored in this variant (bare is always a dot).
   *
   * `label` stays required, but (Finding 4, Codex facet) is rendered as
   * REAL visually-hidden (`sr-only`) DOM text on a nested span -- not as an
   * `aria-label` attribute on the generic, non-focusable root `<span>`,
   * which many assistive-tech paths don't reliably announce. The dot itself
   * carries no visible text (Finding 4, CodeRabbit facet: a colorblind
   * sighted user still gets nothing from the dot alone) -- callers that
   * need a color-independent VISIBLE cue must render their own text next to
   * `bare` (see StationsCard.tsx, which does exactly this for its fresh/
   * stale station rows).
   *
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
      <span className={cn("relative inline-flex shrink-0", className)}>
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
        {/* Finding 4 (Codex facet): real DOM text, not aria-label on this
            generic span -- matches the sr-only idiom already used by
            RecentFeedCard.tsx/WorkspaceRail.tsx elsewhere in this codebase. */}
        <span className="sr-only">{label}</span>
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
