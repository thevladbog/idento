// P4.1 Task 8 -- the check-in station itself. Registered in
// app/router.tsx as `eventCheckinRoute`, a TOP-LEVEL protected route that
// is a SIBLING of `eventWorkspaceRoute` (not one of its children) -- so
// this page renders WITHOUT the workspace rail shell (WorkspaceRail /
// EventWorkspaceLayout), near-fullscreen, escaping only that chrome (it is
// still wrapped by the outer AppShell/NavDrawer, same as every other
// protected route).
//
// Wires together Task 5's settings/data layer, Task 6's verdict state
// machine, Task 7's scan input modes, and Task 9's recent-scans rail: a
// top bar (event name / station name / Exit back to the workspace), the
// main verdict panel (VerdictCard + ScanInput), and the RecentScansRail
// (last-50 check-in actions feed with per-row reprint/undo/details).
//
// `?station=` (the registered station id) is validated by the route's own
// `beforeLoad` (app/router.tsx's checkinStationBeforeLoad,
// features/checkin/searchParams.ts) BEFORE this component ever mounts --
// missing/malformed values redirect to the launch ceremony there, so by
// the time this renders, `search.station` is guaranteed to be a
// non-empty string. This component does NOT separately re-validate it
// against the actually-registered station list: Task 11 owns registering
// stations, and an unregistered-but-well-formed id is treated as a
// station this page simply can't NAME yet (falls back to the raw id in
// the top bar), not as a reason to bounce the operator back to the
// ceremony mid-shift.
import * as React from "react";
import { Button, Skeleton } from "@idento/ui";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { components } from "../../shared/api/schema";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import { $api } from "../../shared/api/query";
import { RecentScansRail } from "./RecentScansRail";
import { ScanInput } from "./ScanInput";
import { VerdictCard } from "./VerdictCard";
import { useCheckinSettings, useCheckinStations } from "./hooks";
import { DEFAULT_CHECKIN_SETTINGS } from "./settingsTypes";
import { useCheckinFlow } from "./useCheckinFlow";
import { useConnectionState } from "./useConnectionState";
import { useHeartbeat } from "./useHeartbeat";

type Attendee = components["schemas"]["Attendee"];

// Same getRouteApi-by-string-id rationale as AttendeesPage.tsx /
// EventWorkspaceLayout.tsx -- avoids a circular import with app/router.tsx
// (which imports THIS component for the route's `component:` field).
const routeApi = getRouteApi("/_app/events/$eventId/checkin");

export function StationPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const stationId = search.station ?? null;

  // Task 12 -- keeps this station's last_seen_at fresh for as long as this
  // page stays mounted (immediate heartbeat + every 20s, cleared on
  // unmount). Mounted unconditionally alongside every other hook here (no
  // early return above it) per Rules of Hooks; the hook itself no-ops
  // internally when `stationId` is null.
  useHeartbeat(eventId, stationId);

  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });
  const stationsQuery = useCheckinStations(eventId);
  const settingsQuery = useCheckinSettings(eventId);
  // Agent reachability is polled unconditionally while this station is
  // mounted (same idiom as AttendeeDrawer.tsx's reprint button) -- the
  // check-in flow needs SOME printer name to forward to usePrintBadge on a
  // checked_in outcome, and `defaultPrinter` always resolves to something
  // once any printer exists (useAgentPrinters' own "always have a
  // preselection" rule).
  const agent = useAgentPrinters(true);

  // Falls back to DEFAULT_CHECKIN_SETTINGS while settingsQuery is still
  // loading (or if it ever errors) -- useCheckinFlow needs a fully-formed
  // CheckinSettings unconditionally (Rules of Hooks: this hook, like every
  // other one here, must be called on every render regardless of loading
  // state), and parseCheckinSettings' own defaults are exactly what an
  // event with no saved settings yet would resolve to server-side anyway.
  const settings = settingsQuery.data ?? DEFAULT_CHECKIN_SETTINGS;

  const flow = useCheckinFlow({
    eventId,
    stationId,
    settings,
    printerName: agent.defaultPrinter ?? "",
  });

  // P4.1 Task 10 -- degraded mode. `connection.online` folds
  // navigator.onLine/the browser's online/offline events and the checkin-
  // actions feed's own isError (after react-query's default retries) into
  // one debounced signal (useConnectionState's own module comment). This
  // task is display/UX degradation ONLY (the phase spec explicitly rules an
  // offline write queue out of scope -- offline ownership stays with the
  // kiosks): no scan is ever queued for later, it's either sent now or the
  // operator sees an explicit "can't check in — offline" state.
  const connection = useConnectionState(eventId);

  // Set only when a scan/pick was attempted WHILE offline (never on mount,
  // never just because the banner is showing) -- cleared as soon as the
  // connection recovers, so a stale "offline" card can't linger once
  // check-ins are actually working again.
  const [offlineBlocked, setOfflineBlocked] = React.useState(false);
  React.useEffect(() => {
    if (connection.online) setOfflineBlocked(false);
  }, [connection.online]);

  // These wrap ScanInput's onCode/onPickAttendee (not useCheckinFlow
  // itself, which Task 6 owns unmodified) -- the interception happens HERE,
  // before either of useCheckinFlow's own network calls (submitCode's own
  // GET-by-code lookup, submitAttendee's POST /checkin), so a scan attempted
  // while offline never reaches the network at all. Wedge/scanner capture
  // itself stays enabled regardless of connectivity (ScanInput's own
  // `enabled` prop below is untouched by `connection.online`) so a real
  // physical scan is always CONSUMED -- never silently dropped -- even
  // while offline; this is what shows the explicit offline verdict instead.
  function handleCode(code: string) {
    if (!connection.online) {
      setOfflineBlocked(true);
      return;
    }
    setOfflineBlocked(false);
    void flow.submitCode(code);
  }

  function handlePickAttendee(attendee: Attendee) {
    if (!connection.online) {
      setOfflineBlocked(true);
      return;
    }
    setOfflineBlocked(false);
    void flow.submitAttendee(attendee);
  }

  if (eventQuery.isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-6" data-testid="checkin-station-page">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6" data-testid="checkin-station-page">
        <p className="text-body text-destructive">{t("workspaceLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/">{t("workspaceBackHome")}</Link>
        </Button>
      </div>
    );
  }

  const event = eventQuery.data;
  const station = stationsQuery.data?.stations.find((entry) => entry.id === stationId);
  const scanEnabled = flow.state.status === "idle";

  return (
    <div className="flex h-full flex-col" data-testid="checkin-station-page">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="text-page-title">{event.name}</h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-caption text-muted-foreground">
          {stationsQuery.isLoading ? <Skeleton className="h-4 w-16" /> : (station?.name ?? stationId)}
        </span>
        <div className="ml-auto">
          <Button asChild variant="outline">
            <Link to="/events/$eventId" params={{ eventId }}>
              <ArrowLeft aria-hidden className="size-4" />
              {t("checkinExit")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Task 10 -- degraded mode's amber banner (board 2d copy,
          `checkinDegradedBanner`), same solid-warning treatment
          ImpersonationBanner.tsx already establishes for a station-wide,
          hard-to-miss connectivity notice. */}
      {!connection.online ? (
        <div
          role="status"
          data-testid="checkin-degraded-banner"
          className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-body font-medium text-warning-foreground"
        >
          <WifiOff aria-hidden className="size-4" />
          {t("checkinDegradedBanner")}
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
          {offlineBlocked ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-12 text-center"
              data-testid="checkin-verdict-offline"
            >
              <WifiOff aria-hidden className="size-10 text-warning" />
              <p className="text-page-title text-warning">{t("checkinOfflineBlocked")}</p>
            </div>
          ) : (
            <VerdictCard state={flow.state} />
          )}
          <ScanInput
            eventId={eventId}
            mode={settings.scan_input}
            enabled={scanEnabled}
            readOnly={!connection.online}
            onCode={handleCode}
            onPickAttendee={handlePickAttendee}
          />
        </div>

        {/* Task 9's recent-scans rail -- the last-50 check-in actions feed
            (reprint/undo/details). 296px per the board's own stated width. */}
        <aside className="w-[296px] flex-none overflow-y-auto border-l border-border p-4">
          <RecentScansRail eventId={eventId} stationId={stationId} online={connection.online} />
        </aside>
      </div>
    </div>
  );
}
