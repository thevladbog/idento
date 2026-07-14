import { cn, Skeleton, StatusPill, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@idento/ui";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { components } from "../../shared/api/schema";

type EventReadinessResponse = components["schemas"]["EventReadinessResponse"];
type ReadinessStep = components["schemas"]["ReadinessStep"];

const STEP_LABEL_KEYS: Record<ReadinessStep["key"], string> = {
  attendees: "readinessStepAttendees",
  badge: "readinessStepBadge",
  zones: "readinessStepZones",
  staff: "readinessStepStaff",
  equipment: "readinessStepEquipment",
};

export interface ReadinessCellProps {
  readiness: EventReadinessResponse | undefined;
}

// Board 1c col 4 — a compact 5-segment readiness bar + "N of M ready"
// fraction, wrapped in a Tooltip carrying the full per-step breakdown (the
// 1e "bullets" detail, ported onto this compact cell rather than read
// literally off 1c). A zero-progress event (no step marked "done" yet) is a
// fresh draft: the board's "zero-progress draft" state collapses the
// bar+fraction into a neutral StatusPill instead, since an all-gray bar
// plus "0 of N ready" would say "nothing happened" twice.
export function ReadinessCell({ readiness }: ReadinessCellProps) {
  const { t } = useTranslation();

  if (!readiness) {
    return <Skeleton className="h-7 w-32" />;
  }

  const { steps } = readiness;
  const done = steps.filter((step) => step.status === "done").length;
  const total = steps.filter((step) => step.status !== "skipped").length;
  const isDraft = done === 0;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-default rounded-sm border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isDraft ? (
              <StatusPill status="optional" label={t("homeDraft")} />
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex gap-0.5">
                  {steps.map((step) => (
                    <div
                      key={step.key}
                      data-readiness-segment={step.status}
                      className={cn("h-1.5 w-8 rounded-sm", step.status === "done" ? "bg-success" : "bg-muted")}
                    />
                  ))}
                </div>
                <span className="text-caption text-muted-foreground">{t("homeReadyFraction", { done, total })}</span>
              </div>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <ul className="flex flex-col gap-1">
            {steps.map((step) => {
              const Icon = step.status === "done" ? CheckCircle2 : step.status === "skipped" ? MinusCircle : Circle;
              return (
                <li key={step.key} className="flex items-center gap-1.5">
                  <Icon aria-hidden className="size-3 shrink-0" />
                  <span>{t(STEP_LABEL_KEYS[step.key])}</span>
                  {step.status === "skipped" ? (
                    <span className="text-muted-foreground">({t("readinessSkipped")})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
