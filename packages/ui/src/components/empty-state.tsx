import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-10 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="text-card-title">{title}</h3>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 pt-1">{actions}</div> : null}
    </div>
  );
}
