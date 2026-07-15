import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { Circle, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { STEP_LABEL_KEYS } from "../home/ReadinessCell";
import { useEventReadiness, useEventStats } from "../events/hooks";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

type ReadinessStep = components["schemas"]["ReadinessStep"];

// Same rationale as EventWorkspaceLayout.tsx: `getRouteApi` with the parent
// layout route's string id (not an import from app/router.tsx) avoids a
// circular import, and params declared on that ancestor route are resolvable
// from this component even though it's mounted one level down at the child
// index route ("/_app/events/$eventId/").
const routeApi = getRouteApi("/_app/events/$eventId");

// The readiness pipeline steps that can ever appear as a "what's next" row —
// zones is intentionally excluded (board 1f: it's optional and never blocks,
// so it never earns a spot in the top-2 outstanding-items list even when
// it's not_done).
type NextStepKey = Exclude<ReadinessStep["key"], "zones">;

const NEXT_STEP_ORDER: NextStepKey[] = ["attendees", "badge", "staff", "equipment"];

const NEXT_DESCRIPTION_KEYS: Record<NextStepKey, string> = {
  attendees: "workspaceNextAttendees",
  badge: "workspaceNextBadge",
  staff: "workspaceNextStaff",
  equipment: "workspaceNextEquipment",
};

// Board 1f §4 — the workspace index route's Overview panel: a "What's next"
// card surfacing up to the top two outstanding readiness steps (or an
// all-ready message), plus a 4-tile stat grid. Mounted at the index route via
// `<Outlet/>`, so it fetches readiness/stats/zones itself rather than
// receiving them as props from EventWorkspaceLayout.
export function WorkspaceOverview() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const readiness = useEventReadiness(eventId);
  const stats = useEventStats(eventId);
  const zonesQuery = $api.useQuery("get", "/api/events/{event_id}/zones", { params: { path: { event_id: eventId } } });

  const steps = readiness.data?.steps;
  const stepsByKey = new Map(steps?.map((step) => [step.key, step]) ?? []);
  const ready = readiness.data?.ready === true;

  const nextSteps = NEXT_STEP_ORDER.map((key) => ({ key, step: stepsByKey.get(key) })).filter(
    (entry): entry is { key: NextStepKey; step: ReadinessStep } => entry.step?.status === "not_done",
  ).slice(0, 2);

  const zonesStep = stepsByKey.get("zones");
  const zonesSkipped = zonesStep?.status === "skipped";
  const zoneNamesCaption = zonesQuery.data?.slice(0, 2).map((entry) => zoneIdentity(entry).name).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-page-title">{t("workspaceOverviewTitle")}</h2>
        <p className="text-caption text-muted-foreground">{t("workspaceOverviewSubtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("workspaceWhatsNext")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {readiness.isLoading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : readiness.isError ? (
            <p className="text-body text-destructive">{t("workspaceLoadError")}</p>
          ) : ready ? (
            <p className="text-body text-muted-foreground">{t("workspaceAllReady")}</p>
          ) : (
            <div data-testid="workspace-next-steps" className="flex flex-col gap-2">
              {nextSteps.map(({ key, step }) => (
                <NextStepRow key={key} stepKey={key} step={step} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div data-testid="workspace-stat-tiles" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          title={t("readinessStepAttendees")}
          value={stepsByKey.get("attendees")?.count}
          isLoading={readiness.isLoading}
          isError={readiness.isError}
        />
        <StatTile
          title={t("readinessStepZones")}
          value={zonesStep?.count}
          isLoading={readiness.isLoading}
          isError={readiness.isError}
          caption={
            zonesSkipped ? (
              <p className="text-caption text-muted-foreground">{t("workspaceZonesNotUsed")}</p>
            ) : zonesQuery.isLoading ? (
              <Skeleton className="h-4 w-24" />
            ) : zonesQuery.isError ? (
              <p className="text-caption text-destructive">{t("workspaceStatUnavailable")}</p>
            ) : zoneNamesCaption ? (
              <p className="text-caption text-muted-foreground">{zoneNamesCaption}</p>
            ) : null
          }
        />
        <StatTile
          title={t("readinessStepStaff")}
          value={stepsByKey.get("staff")?.count}
          isLoading={readiness.isLoading}
          isError={readiness.isError}
        />
        <StatTile
          title={t("workspaceStatCheckedIn")}
          value={stats.data?.checked_in}
          isLoading={stats.isLoading}
          isError={stats.isError}
          caption={<p className="text-caption text-muted-foreground">/ {stats.data?.total_attendees ?? 0}</p>}
        />
      </div>
    </div>
  );
}

function NextStepRow({ stepKey, step }: { stepKey: NextStepKey; step: ReadinessStep }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-body font-medium text-foreground">{t(STEP_LABEL_KEYS[step.key])}</p>
        <p className="text-caption text-muted-foreground">{t(NEXT_DESCRIPTION_KEYS[stepKey])}</p>
      </div>
      {/* Muted, non-interactive chip — not a button/link. Every target
          screen (Attendees/Badge/Staff/Equipment) doesn't exist yet, so this
          mirrors the rail's always-locked, never-a-dead-link pattern
          (WorkspaceRail's Check-in row) rather than offering a fake CTA. */}
      <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
        <Lock aria-hidden className="size-3" />
        {t("workspaceStepComingSoon")}
      </span>
    </div>
  );
}

interface StatTileProps {
  title: string;
  value: number | undefined;
  isLoading: boolean;
  isError: boolean;
  caption?: ReactNode;
}

// Loading -> Skeleton; per-query error -> em-dash placeholder styled as an
// error caption, NEVER a fabricated 0 (P1.1 rule, restated in the P1.2
// brief). `caption` (when provided) only renders in the success branch, so a
// tile's secondary line (e.g. Zones' zone names, Checked-in's "/ total")
// never appears alongside a loading/error primary value either.
function StatTile({ title, value, isLoading, isError, caption }: StatTileProps) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-caption text-muted-foreground">{title}</span>
      {isLoading ? (
        <Skeleton className="h-7 w-12" />
      ) : isError ? (
        <p className="text-caption text-destructive">{t("workspaceStatUnavailable")}</p>
      ) : (
        <>
          <p className="font-mono text-2xl font-bold text-foreground">{value ?? 0}</p>
          {caption}
        </>
      )}
    </Card>
  );
}
