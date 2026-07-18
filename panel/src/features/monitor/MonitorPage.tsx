// P4.2 Task 7 -- the live monitor itself (board 7e, tablet-landscape,
// "glanceable from across the room, read-only, no prep chrome"). Registered
// in app/router.tsx as `eventMonitorRoute`, a TOP-LEVEL protected route
// that is a SIBLING of `eventWorkspaceRoute` (not one of its children) --
// so this page renders WITHOUT the workspace rail shell (WorkspaceRail /
// EventWorkspaceLayout), mirroring `eventCheckinRoute`'s exact pattern
// (plan-time fact 7). It is still wrapped by the outer AppShell/NavDrawer,
// same as every other protected route.
//
// Wires together Task 5/6's data layer (`useMonitorSnapshot` for the
// numbers, `useMonitorStream` for the header's LIVE pill + as the thing
// that keeps the snapshot fresh via invalidation elsewhere) with the left-
// column cards (TotalsCard, ZonesCard, Task 7) and the right-column cards
// (StationsCard, RecentFeedCard, Task 8) plus the header's amber
// `monitorReconnecting` badge (also Task 8) -- shown whenever
// `stream.status === "reconnecting"`, with the already-fetched snapshot
// content staying rendered underneath it (a dead stream degrades the
// header, never blanks the body).
import * as React from "react";
import { Button, Card, CardContent, Skeleton } from "@idento/ui";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $api } from "../../shared/api/query";
import { RecentFeedCard } from "./RecentFeedCard";
import { StationsCard } from "./StationsCard";
import { TotalsCard } from "./TotalsCard";
import { ZonesCard } from "./ZonesCard";
import { useMonitorSnapshot } from "./hooks";
import { useMonitorStream } from "./useMonitorStream";

// `getRouteApi` with the route's string id, not an import of the route
// object from app/router.tsx -- avoids a circular import (router.tsx
// imports THIS component for the route's `component:` field), same
// rationale as StationPage.tsx / EventWorkspaceLayout.tsx.
const routeApi = getRouteApi("/_app/events/$eventId/monitor");

export function MonitorPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();

  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });
  const snapshotQuery = useMonitorSnapshot(eventId);
  const stream = useMonitorStream(eventId);

  // Local 1s ticker, purely to force a re-render every second so "Updated
  // Ns ago" (derived from snapshotQuery's own `dataUpdatedAt` -- react-
  // query's wall-clock timestamp of the last successful fetch) keeps
  // counting up between snapshot refetches, matching the board's own
  // "Updated 3 s ago" staleness label reading as a live-ticking clock, not
  // a value frozen at fetch time.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (eventQuery.isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-6" data-testid="monitor-page">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6" data-testid="monitor-page">
        <p className="text-body text-destructive">{t("workspaceLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/">{t("workspaceBackHome")}</Link>
        </Button>
      </div>
    );
  }

  const event = eventQuery.data;
  const updatedSeconds =
    snapshotQuery.dataUpdatedAt > 0 ? Math.max(0, Math.floor((now - snapshotQuery.dataUpdatedAt) / 1000)) : null;
  const live = stream.status === "live";
  const snapshot = snapshotQuery.data;

  return (
    <div className="flex h-full flex-col" data-testid="monitor-page">
      {/* Header (56px per the board) -- LIVE pill · event name · "Updated
          Ns ago" staleness label · (reconnecting badge, when the stream is
          down) · Exit. */}
      <div className="flex h-14 flex-none items-center gap-3 border-b border-border px-4">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-caption font-bold uppercase text-success"
          data-testid="monitor-live-pill"
        >
          <span className="relative flex size-2">
            {live ? (
              <span
                data-testid="monitor-live-ring"
                className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75"
              />
            ) : null}
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          {t("monitorLive")}
        </span>
        <h1 className="text-page-title">{event.name}</h1>
        {updatedSeconds !== null ? (
          <span className="text-caption text-muted-foreground" data-testid="monitor-updated-ago">
            {t("monitorUpdatedAgo", { seconds: updatedSeconds })}
          </span>
        ) : null}
        {/* Global Constraints: a dead stream shows a reconnecting badge
            OVER stale data -- the body below keeps rendering whatever
            snapshot was last fetched, unconditionally on stream.status. */}
        {stream.status === "reconnecting" ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-caption font-bold uppercase text-warning"
            data-testid="monitor-reconnecting-badge"
          >
            {t("monitorReconnecting")}
          </span>
        ) : null}
        <div className="ml-auto">
          <Button asChild variant="outline">
            <Link to="/events/$eventId" params={{ eventId }}>
              <ArrowLeft aria-hidden className="size-4" />
              {t("monitorExit")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Body -- #fafafa background (theme.css's --background token is
          already that exact value), 2-column grid (1.15fr 1fr) per board
          7e. */}
      <div className="grid flex-1 gap-4 overflow-y-auto bg-background p-6" style={{ gridTemplateColumns: "1.15fr 1fr" }}>
        {snapshotQuery.isLoading ? (
          <>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 flex-1 w-full" />
            </div>
          </>
        ) : snapshotQuery.isError || !snapshot ? (
          <>
            <div className="flex flex-col gap-4">
              <Card>
                <CardContent className="p-6">
                  <p className="text-body text-destructive" data-testid="monitor-snapshot-error">
                    {t("monitorSnapshotLoadError")}
                  </p>
                </CardContent>
              </Card>
            </div>
            <div className="flex flex-col gap-4" />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <TotalsCard totals={snapshot.totals} />
              <ZonesCard
                zones={snapshot.zones}
                unattributed={snapshot.unattributed}
                checkedInTotal={snapshot.totals.checked_in}
              />
            </div>

            {/* Right column (board 7e) -- Stations card (liveness, Task 8)
                above the read-only Last-scans card, which grows to fill
                the remaining height (`flex-1` on the wrapper, matching the
                board's own "flex:1" note on this card). */}
            <div className="flex flex-col gap-4">
              <div data-testid="monitor-stations-placeholder">
                <StationsCard stations={snapshot.stations} now={now} />
              </div>
              <div className="flex flex-1 flex-col" data-testid="monitor-recent-placeholder">
                <RecentFeedCard recent={snapshot.recent} stations={snapshot.stations} zones={snapshot.zones} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
