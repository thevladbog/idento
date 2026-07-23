import { cn } from "@idento/ui";
import { Check, Circle, MinusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { STEP_LABEL_KEYS } from "../../shared/lib/readinessLabels";
import type { components } from "../../shared/api/schema";

type ReadinessStep = components["schemas"]["ReadinessStep"];

// Board 8e — the phone-only readiness pipeline strip. Below `md` the
// workspace rail (and its pipeline) is hidden, so Overview surfaces the
// same steps as a horizontally scrollable chip row. Icon + text + sr-only
// status, never color alone (WCAG 1.4.1, same rule as WorkspaceRail).
export function ReadinessStrip({ steps }: { steps: ReadinessStep[] | undefined }) {
  const { t } = useTranslation();
  if (!steps?.length) return null;
  return (
    <div data-testid="readiness-strip" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:hidden">
      {steps.map((step) => {
        const done = step.status === "done";
        const skipped = step.status === "skipped";
        const statusText = done
          ? t("readinessStatusDone")
          : skipped
            ? t("readinessSkipped")
            : t("readinessStatusNotDone");
        return (
          <span
            key={step.key}
            className={cn(
              "inline-flex flex-none items-center gap-1 rounded-full border px-2.5 py-1 text-caption font-medium",
              done && "border-success/30 bg-success/10 text-success",
              skipped && "border-dashed border-border bg-muted text-muted-foreground",
              !done && !skipped && "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            {done ? <Check aria-hidden className="size-3" /> : skipped ? <MinusCircle aria-hidden className="size-3" /> : <Circle aria-hidden className="size-3" />}
            {t(STEP_LABEL_KEYS[step.key])}
            {step.count !== undefined ? <span className="font-mono">{step.count}</span> : null}
            <span className="sr-only">{statusText}</span>
          </span>
        );
      })}
    </div>
  );
}
