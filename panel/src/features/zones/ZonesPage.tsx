import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, EmptyState, Skeleton, cn,
} from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEventZonesWithStats } from "./hooks";
import { ZONE_COLOR_CLASSES, zoneColorKey } from "./zoneColors";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";
import type { components } from "../../shared/api/schema";

type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

// Same rationale as AttendeesPage.tsx / EventWorkspaceLayout.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/zones");

// Board 6b — the zones list screen: header (title + mono count + caption),
// a compact zone-row list card, empty/loading/error states. The "+ New
// zone" button and the row `⋯` menu's items are wired by Tasks 3-4 — this
// task only renders them (no onClick / no menu items yet).
export function ZonesPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const zonesQuery = useEventZonesWithStats(eventId);

  const zones = zonesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-page-title">{t("zonesTitle")}</h2>
          {zonesQuery.isLoading ? (
            <Skeleton className="h-4 w-8" data-testid="zones-total-skeleton" />
          ) : (
            <span className="font-mono text-caption text-muted-foreground">{zones.length}</span>
          )}
        </div>
        <span className="text-caption text-muted-foreground">{t("zonesCaption")}</span>
        <div className="ml-auto">
          <Button type="button">{t("zonesNewZone")}</Button>
        </div>
      </div>

      {zonesQuery.isLoading ? (
        <ZonesListSkeleton />
      ) : zonesQuery.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-6">
          <p className="text-body text-destructive">{t("zonesLoadError")}</p>
          <Button type="button" variant="outline" onClick={() => zonesQuery.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : zones.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t("zonesEmptyTitle")}
          description={t("zonesEmptyBody")}
          actions={<Button type="button">{t("zonesNewZone")}</Button>}
        />
      ) : (
        <div className="flex flex-col rounded-lg border border-border">
          {zones.map((entry) => (
            <ZoneRow key={zoneIdentity(entry).id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function ZoneRow({ entry }: { entry: EventZoneWithStats }) {
  const { t } = useTranslation();
  const { zone } = entry;
  const identity = zoneIdentity(entry);
  const colorKey = zoneColorKey(zone);

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", ZONE_COLOR_CLASSES[colorKey])} />
      <div className="flex flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="text-body font-bold">{identity.name}</span>
          {zone.is_active === false ? (
            <span className="text-caption font-normal text-muted-foreground">{t("zonesInactive")}</span>
          ) : null}
        </span>
        {/* Reconciliation #2 (P2.2 plan): "Entrance zone" ≡ is_registration_zone
            — no other entrance concept exists on the model. */}
        {zone.is_registration_zone ? (
          <span className="text-caption text-muted-foreground">{t("zonesEntranceSubtitle")}</span>
        ) : null}
      </div>
      {/* Reconciliation #3: rules default-allow when none exist, so
          access_rules_count === 0 reads as "All attendees"; > 0 as "By
          rule" (real rule count, never a fabricated people/match count —
          reconciliation #4 bans those everywhere on this page). */}
      <span className="text-body text-muted-foreground">
        {entry.access_rules_count === 0 ? t("zonesAccessAll") : t("zonesAccessByRule", { count: entry.access_rules_count })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("zonesRowMenuLabel", { name: identity.name })}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            ⋯
          </button>
        </DropdownMenuTrigger>
        {/* Empty for now — Tasks 3 (edit/delete) and 4 (rule builder entry
            point) populate this menu's items. */}
        <DropdownMenuContent align="end" />
      </DropdownMenu>
    </div>
  );
}

function ZonesListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="zones-list-skeleton">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
