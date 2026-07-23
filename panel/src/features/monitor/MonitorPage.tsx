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
//
// PR #81 bot round: the header's LIVE pill/reconnecting badge/stream-error
// badge are composed from `@idento/ui`'s `StatusPill` (Finding C1 --
// panel/AGENTS.md's "UI primitives come only from @idento/ui"; the
// pulsing-dot variant this needed was genuinely missing, so it was added to
// the primitive itself rather than hand-rolled here again). `stream.status
// === "error"` (Finding C3 -- a terminal 4xx on the SSE connection, e.g. an
// expired session or a suspended tenant) replaces the LIVE pill entirely
// with a destructive-colored badge -- reconnecting has already permanently
// stopped by that point, so a "reconnecting" badge would be a lie; the body
// below still keeps rendering the last good snapshot underneath it (Finding
// C6 -- retain-last-known-good, gated on `!snapshot` rather than
// `isError`, so a single failed background refetch never blanks the page).
import * as React from "react";
import { Button, Card, CardContent, Skeleton, StatusPill, cn } from "@idento/ui";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $api } from "../../shared/api/query";
import { EventTabBar } from "../workspace/EventTabBar";
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

  // PR #81 bot round Finding C6: gated on `!eventQuery.data` alone, not
  // `isError || !data` -- once the event has loaded once, a single failed
  // background refetch (isError=true, data still retained per react-query)
  // must not blank the whole page into this error card.
  if (!eventQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6" data-testid="monitor-page">
        {/* PR #81 bot round Finding C7: monitor-owned copy -- this page no
            longer borrows workspace's `workspaceLoadError`/`workspaceBackHome`
            keys (panel/AGENTS.md's cross-surface i18n convention). */}
        <p className="text-body text-destructive">{t("monitorLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/">{t("monitorBackHome")}</Link>
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
        {stream.status === "error" ? (
          // Finding C3: a terminal stream failure (401/403 tenant_suspended/
          // documented 4xx) has already stopped reconnecting for good --
          // showing "LIVE" or "Reconnecting" here would misrepresent a dead
          // connection as merely degraded. The global handling this status
          // triggers (useMonitorStream.ts -- session redirect / suspension
          // takeover) runs independently of this badge.
          <span data-testid="monitor-stream-error-badge">
            <StatusPill status="error" label={t("monitorStreamError")} className="font-bold uppercase" />
          </span>
        ) : (
          <>
            <span data-testid="monitor-live-pill">
              <StatusPill
                status="ready"
                label={t("monitorLive")}
                indicator="dot"
                pulse={live}
                className="font-bold uppercase"
              />
            </span>
            {/* Global Constraints: a dead-but-retryable stream shows a
                reconnecting badge OVER stale data -- the body below keeps
                rendering whatever snapshot was last fetched, unconditionally
                on stream.status. */}
            {stream.status === "reconnecting" ? (
              <span data-testid="monitor-reconnecting-badge">
                <StatusPill status="in_progress" label={t("monitorReconnecting")} className="font-bold uppercase" />
              </span>
            ) : null}
          </>
        )}
        <h1 className="text-page-title">{event.name}</h1>
        {updatedSeconds !== null ? (
          // Board 8p -- the staleness counter is part of the stream-state
          // vocabulary: muted mono while live (data is provably fresh),
          // warning tone + clock icon while degraded (the counter is the
          // "how stale" answer the amber badge alone can't give). Icon +
          // text + color, never color alone (WCAG 1.4.1).
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-caption",
              live ? "text-muted-foreground" : "text-warning",
            )}
            data-testid="monitor-updated-ago"
          >
            {live ? null : <Clock aria-hidden className="size-3" />}
            {t("monitorUpdatedAgo", { seconds: updatedSeconds })}
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

      {/* Board 8p -- aria-live announces stream-state changes; content
          change (live -> reconnecting -> error) is what triggers the
          announcement, so this renders the current state's label. */}
      <span aria-live="polite" className="sr-only" data-testid="monitor-stream-announcer">
        {stream.status === "live"
          ? t("monitorLive")
          : stream.status === "reconnecting"
            ? t("monitorReconnecting")
            : t("monitorStreamError")}
      </span>

      {/* Body -- #fafafa background (theme.css's --background token is
          already that exact value), 2-column grid (1.15fr 1fr) per board
          7e. */}
      {/* INTERIM phone stack (P6.1): single column below `md` so nothing
          overflows at 390px; the real glanceable phone layout is P6.2
          (board 8f). Desktop/tablet keeps board 7e's two-column grid. */}
      <div
        data-testid="monitor-body"
        className={cn(
          "grid flex-1 grid-cols-1 gap-4 overflow-y-auto bg-background p-4 pb-24 transition-opacity md:p-6 md:[grid-template-columns:1.15fr_1fr]",
          // Board 8p -- stale numbers never masquerade as live: anything
          // short of an open stream dims the whole body to 60%.
          !live && "opacity-60",
        )}
      >
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
        ) : !snapshot ? (
          // PR #81 bot round Finding C6: gated on `!snapshot` alone, not
          // `snapshotQuery.isError || !snapshot` -- once the snapshot has
          // loaded once, a single failed background refetch (isError=true,
          // data still retained per react-query) must not blank the body
          // into this error card. The "reconnecting"/"error" header badges
          // above already cover a degraded live connection; this card is
          // reserved for genuinely having nothing to show yet.
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

      {/* Monitor is a rail-less top-level route (no EventWorkspaceLayout),
          so it mounts the phone tab bar itself -- otherwise the floor loop
          (Overview/Attendees/Staff/More) would be unreachable below `md`
          once the Exit button scrolls out of the header. */}
      <EventTabBar eventId={eventId} />
    </div>
  );
}
