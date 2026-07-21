import type * as React from "react";
import { cn } from "../lib/cn";

// P5.3.3 Task 2 -- role="status" implies aria-live="polite" per the ARIA
// spec (WCAG 4.1.3, Status Messages), so a screen reader announces the
// placeholder without the caller wiring anything up. The default English
// name is overridable via the standard `aria-label` prop -- same convention
// NumberInput's decrementLabel/incrementLabel establishes: no i18n
// dependency, since @idento/ui carries none by design.
export function Skeleton({
  className,
  "aria-label": ariaLabel = "Loading",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
