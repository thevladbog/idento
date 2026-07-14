import { cn, Separator, Skeleton } from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Lock, MinusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { STEP_LABEL_KEYS } from "../home/ReadinessCell";
import type { components } from "../../shared/api/schema";

type EventReadinessResponse = components["schemas"]["EventReadinessResponse"];
type ReadinessStep = components["schemas"]["ReadinessStep"];

export interface WorkspaceRailProps {
  eventId: string;
  readiness: EventReadinessResponse | undefined;
  active: "overview" | "settings";
}

// Board 1f — the left-rail readiness pipeline for the event workspace. Pure,
// props-driven: this task only builds the rail itself (Task 2 mounts it in
// the workspace layout route and supplies real `readiness`/`active`).
export function WorkspaceRail({ eventId, readiness, active }: WorkspaceRailProps) {
  const { t } = useTranslation();
  const steps = readiness?.steps;
  const zonesSkipped = steps?.find((step) => step.key === "zones")?.status === "skipped";
  const done = steps?.filter((step) => step.status === "done").length ?? 0;
  const total = steps?.filter((step) => step.status !== "skipped").length ?? 0;

  return (
    <nav className="flex h-full w-[236px] flex-none flex-col gap-3 border-r border-border bg-background p-3 pb-4.5">
      <div className="flex flex-col gap-1.5">
        {steps ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-caption font-bold">{t("homeReadyFraction", { done, total })}</span>
              {zonesSkipped ? (
                <span className="text-caption text-muted-foreground">{t("workspaceZonesOptional")}</span>
              ) : null}
            </div>
            <div className="flex gap-0.5">
              {steps.map((step) => (
                <div
                  key={step.key}
                  data-readiness-segment={step.status}
                  className={cn("h-1.5 flex-1 rounded-sm", step.status === "done" ? "bg-success" : "bg-muted")}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-1.5 w-full" />
          </>
        )}
      </div>

      <Link
        to="/events/$eventId"
        params={{ eventId }}
        aria-current={active === "overview" ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted",
          active === "overview" && "bg-success/10 text-success",
        )}
      >
        <span aria-hidden className="flex size-[18px] items-center justify-center rounded-full bg-success text-[10px] text-success-foreground">
          •
        </span>
        {t("workspaceOverview")}
      </Link>

      <div className="flex flex-col gap-0.5">
        {steps
          ? steps.map((step, index) => <StepRow key={step.key} step={step} index={index + 1} />)
          : Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-7 w-full" />)}
      </div>

      <Separator />

      {/* Check-in is always shown locked in the rail regardless of `ready` —
          the actionable unlock lives on the workspace header button (Task 2). */}
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body text-muted-foreground">
        <Lock aria-hidden className="size-3.5 shrink-0" />
        <span className="flex-1">{t("workspaceCheckin")}</span>
        <span>{t("workspaceCheckinLocked")}</span>
      </div>

      <Link
        to={"/events/$eventId/settings" as never}
        params={{ eventId } as never}
        aria-current={active === "settings" ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-body text-muted-foreground hover:bg-muted",
          active === "settings" && "bg-success/10 text-success",
        )}
      >
        <span aria-hidden className="size-3.5 shrink-0" />
        {t("workspaceSettings")}
      </Link>

      {readiness?.ready !== true ? (
        <div className="mt-auto rounded-md border border-warning/30 bg-warning/10 p-2 text-caption text-warning">
          {t("workspaceUnlockHint")}
        </div>
      ) : null}
    </nav>
  );
}

function StepRow({ step, index }: { step: ReadinessStep; index: number }) {
  const { t } = useTranslation();
  const Icon = step.status === "done" ? CheckCircle2 : step.status === "skipped" ? MinusCircle : Circle;
  // Icon + color alone can't convey status to assistive tech (WCAG 1.4.1) —
  // every status gets a real (sr-only) text label here, mirroring
  // ReadinessCell's tooltip pattern of always pairing icon + text + color.
  const statusText =
    step.status === "done" ? t("readinessStatusDone") : step.status === "skipped" ? t("readinessSkipped") : t("readinessStatusNotDone");

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        {index} · {t(STEP_LABEL_KEYS[step.key])}
        {step.key === "zones" && step.status === "skipped" ? (
          <span className="ml-1 text-caption text-muted-foreground">{t("workspaceOptionalSuffix")}</span>
        ) : null}
      </span>
      <span className="sr-only">{statusText}</span>
      {step.count !== undefined ? <span className="font-mono text-caption">{step.count}</span> : null}
    </div>
  );
}
