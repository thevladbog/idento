import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";

export interface TabBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Accessible name for the nav landmark (e.g. "Event sections"). */
  label: string;
}

// Board 8a/8r — bottom tab-bar chrome for phone-width event workspaces.
// Pure presentation: consumers wrap TabBarItem in their own router <Link>
// (or <button>) and own active-state/aria-current wiring. The safe-area
// padding needs viewport-fit=cover in the host page to be non-zero on iOS.
export function TabBar({ label, className, children, ...props }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex border-t border-border bg-card px-1.5 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    >
      {children}
    </nav>
  );
}

export interface TabBarItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  /** Attention dot (board 8r): warning tone, means "needs a look" — never a count. */
  badge?: boolean;
  className?: string;
}

export function TabBarItem({ icon: Icon, label, active = false, badge = false, className }: TabBarItemProps) {
  return (
    <span
      className={cn(
        "flex min-h-11 w-full flex-col items-center justify-center gap-0.5",
        active ? "text-success" : "text-muted-foreground",
        className,
      )}
    >
      <span className="relative">
        <Icon aria-hidden className="size-5" />
        {badge ? (
          <span
            data-testid="tab-bar-badge"
            aria-hidden
            className="absolute -right-1.5 -top-0.5 size-[7px] rounded-full bg-warning ring-2 ring-card"
          />
        ) : null}
      </span>
      <span className={cn("text-[10px] leading-none", active ? "font-bold" : "font-medium")}>{label}</span>
    </span>
  );
}
