import { PlugZap, Unplug, Wifi, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";

export const AGENT_STATES = ["connected", "stale", "disconnected"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

const config: Record<AgentState, { icon: LucideIcon; dot: string; text: string }> = {
  connected: { icon: Wifi, dot: "bg-success", text: "text-success" },
  stale: { icon: PlugZap, dot: "bg-warning animate-pulse", text: "text-warning" },
  disconnected: { icon: Unplug, dot: "bg-destructive", text: "text-destructive" },
};

export interface AgentStatusProps {
  state: AgentState;
  title: string;
  detail?: string;
  action?: React.ReactNode;
  className?: string;
}

export function AgentStatus({ state, title, detail, action, className }: AgentStatusProps) {
  const { icon: Icon, dot, text } = config[state];
  return (
    <div data-state={state} className={cn("flex items-start gap-3", className)}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("inline-flex items-center gap-1.5 text-card-title", text)}>
          <Icon aria-hidden className="size-4 shrink-0" />
          {title}
        </span>
        {detail ? <span className="text-caption text-muted-foreground">{detail}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
