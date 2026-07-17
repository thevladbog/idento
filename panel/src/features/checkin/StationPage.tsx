// P4.1 Task 8 -- the check-in station itself. Registered in
// app/router.tsx as `eventCheckinRoute`, a TOP-LEVEL protected route that
// is a SIBLING of `eventWorkspaceRoute` (not one of its children) -- so
// this page renders WITHOUT the workspace rail shell (WorkspaceRail /
// EventWorkspaceLayout), near-fullscreen, escaping only that chrome (it is
// still wrapped by the outer AppShell/NavDrawer, same as every other
// protected route).
//
// Wires together Task 5's settings/data layer, Task 6's verdict state
// machine, and Task 7's scan input modes: a top bar (event name / station
// name / Exit back to the workspace), the main verdict panel
// (VerdictCard + ScanInput), and a placeholder rail region Task 9 fills
// with the recent-scans feed.
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
import { Button, Skeleton } from "@idento/ui";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import { $api } from "../../shared/api/query";
import { ScanInput } from "./ScanInput";
import { VerdictCard } from "./VerdictCard";
import { useCheckinSettings, useCheckinStations } from "./hooks";
import { DEFAULT_CHECKIN_SETTINGS } from "./settingsTypes";
import { useCheckinFlow } from "./useCheckinFlow";

// Same getRouteApi-by-string-id rationale as AttendeesPage.tsx /
// EventWorkspaceLayout.tsx -- avoids a circular import with app/router.tsx
// (which imports THIS component for the route's `component:` field).
const routeApi = getRouteApi("/_app/events/$eventId/checkin");

export function StationPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const stationId = search.station ?? null;

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

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
          <VerdictCard state={flow.state} />
          <ScanInput
            eventId={eventId}
            mode={settings.scan_input}
            enabled={scanEnabled}
            onCode={(code) => void flow.submitCode(code)}
            onPickAttendee={(attendee) => void flow.submitAttendee(attendee)}
          />
        </div>

        {/* Placeholder rail region -- Task 9 (RecentScansRail) fills this
            with the last-50 check-in actions feed (reprint/undo/details).
            296px matches that task's own stated width, so the layout
            doesn't shift once it lands. */}
        <aside
          className="w-[296px] flex-none border-l border-border p-4 text-body text-muted-foreground"
          data-testid="checkin-rail-placeholder"
        >
          {t("checkinRailComingSoon")}
        </aside>
      </div>
    </div>
  );
}
