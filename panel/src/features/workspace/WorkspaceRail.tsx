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
  active: "overview" | "settings" | "attendees" | "zones" | "staff" | "badge";
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
        // Without `exact`, Link's default fuzzy active-matching treats this
        // as active for ANY nested path under it (including the sibling
        // `/settings` route, whose path is a string-prefix match on this
        // one) and would stomp the explicit `aria-current` below with its
        // own — surfaced once Task 2 actually mounts both sibling routes
        // together (this rail's own tests only ever exercise a single-route
        // harness, so it never triggers there).
        activeOptions={{ exact: true }}
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
          ? steps.map((step, index) => (
              <StepRow key={step.key} step={step} index={index + 1} eventId={eventId} active={active} />
            ))
          : Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-7 w-full" />)}
      </div>

      <Separator />

      {/* P4.1 Task 11 -- the pinned launch-ceremony CTA at the rail's own
          bottom (board 1f), mirroring the attendees/zones/staff/badge rows'
          own lock->Link unlock idiom (StepRow below): locked (Lock icon +
          discoverable "locked" text, non-interactive) while `!ready`,
          becoming a real Link to the ceremony once the event IS ready. This
          route is a rail-less TOP-LEVEL sibling (app/router.tsx's
          eventCheckinLaunchRoute), so it's never the rail's own "active"
          tab -- navigating here always leaves this rail behind entirely. */}
      {readiness !== undefined && readiness.ready === true ? (
        <Link
          to="/events/$eventId/checkin/launch"
          params={{ eventId }}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted"
        >
          <span aria-hidden className="size-3.5 shrink-0" />
          {t("workspaceCheckin")}
        </Link>
      ) : (
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          <span className="flex-1">{t("workspaceCheckin")}</span>
          <span>{t("workspaceCheckinLocked")}</span>
        </div>
      )}

      <Link
        to="/events/$eventId/settings"
        params={{ eventId }}
        aria-current={active === "settings" ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-body text-muted-foreground hover:bg-muted",
          active === "settings" && "bg-success/10 text-success",
        )}
      >
        <span aria-hidden className="size-3.5 shrink-0" />
        {t("workspaceSettings")}
      </Link>

      {readiness !== undefined && readiness.ready !== true ? (
        <div className="mt-auto rounded-md border border-warning/30 bg-warning/10 p-2 text-caption text-warning">
          {t("workspaceUnlockHint")}
        </div>
      ) : null}
    </nav>
  );
}

// Status -> icon shape + color, kept as one lookup so the two never drift
// apart (a `done` step is both the CheckCircle2 shape *and* the success
// color; the reviewer flagged that the color half of this pairing was
// missing entirely).
const STEP_STATUS_ICON: Record<ReadinessStep["status"], { icon: typeof CheckCircle2; className: string }> = {
  done: { icon: CheckCircle2, className: "text-success" },
  not_done: { icon: Circle, className: "text-muted-foreground" },
  skipped: { icon: MinusCircle, className: "text-muted-foreground" },
};

function StepRow({
  step,
  index,
  eventId,
  active,
}: {
  step: ReadinessStep;
  index: number;
  eventId: string;
  active: WorkspaceRailProps["active"];
}) {
  const { t } = useTranslation();
  const { icon: Icon, className: iconClassName } = STEP_STATUS_ICON[step.status];
  // Icon + color alone can't convey status to assistive tech (WCAG 1.4.1) —
  // every status gets a real (sr-only) text label here, mirroring
  // ReadinessCell's tooltip pattern of always pairing icon + text + color.
  const statusText =
    step.status === "done" ? t("readinessStatusDone") : step.status === "skipped" ? t("readinessSkipped") : t("readinessStatusNotDone");

  const content = (
    <>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", iconClassName)} />
      <span className="flex-1">
        {index} · {t(STEP_LABEL_KEYS[step.key])}
        {step.key === "zones" && step.status === "skipped" ? (
          <span className="ml-1 text-caption text-muted-foreground">{t("workspaceOptionalSuffix")}</span>
        ) : null}
      </span>
      <span className="sr-only">{statusText}</span>
      {step.count !== undefined ? <span className="font-mono text-caption">{step.count}</span> : null}
    </>
  );

  // Attendees (Task 5 of P2.1), Zones (Task 2), Staff (Task 5 of P2.2), and
  // Badge (Task 6 of P3.1) are the readiness steps with a real screen behind
  // them so far — they become live Links while equipment stays exactly as
  // it was (a plain, always-locked row) until its own screen lands in a
  // later phase.
  if (step.key === "attendees" || step.key === "zones" || step.key === "staff" || step.key === "badge") {
    const isActive = active === step.key;
    const to =
      step.key === "attendees"
        ? "/events/$eventId/attendees"
        : step.key === "zones"
          ? "/events/$eventId/zones"
          : step.key === "staff"
            ? "/events/$eventId/staff"
            : "/events/$eventId/badge";
    return (
      <Link
        to={to}
        params={{ eventId }}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted",
          isActive && "bg-success/10 text-success",
        )}
      >
        {content}
      </Link>
    );
  }

  return <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body">{content}</div>;
}
