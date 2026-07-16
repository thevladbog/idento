import {
  Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton,
} from "@idento/ui";
import { Link, Outlet, getRouteApi, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceRail } from "./WorkspaceRail";
import { formatDateRange } from "../events/eventDates";
import { useEventReadiness } from "../events/hooks";
import { $api } from "../../shared/api/query";

// Layout route for the event workspace (board 1f) — replaces the P1.1 stub.
// Owns the header row (event name, date pill, launch-check-in gate) and
// mounts the readiness rail (Task 1) beside whichever child route
// (overview/settings) is currently matched via `<Outlet/>`.
//
// `getRouteApi` with the route's string id ("/_app/events/$eventId") rather
// than importing the route object from app/router.tsx avoids a circular
// import between this module and router.tsx (which imports this component
// for the layout route's `component:` field) — same rationale the deleted
// EventWorkspaceStub carried forward.
const routeApi = getRouteApi("/_app/events/$eventId");

// `active` is derived from the current pathname rather than route-id
// matching (e.g. `useMatchRoute`): a plain suffix check is simpler and
// doesn't tie this component's types to the exact child route objects
// declared in router.tsx.
function useActiveRailTab(): "overview" | "settings" | "attendees" | "zones" | "staff" | "badge" {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/settings")) return "settings";
  if (pathname.endsWith("/attendees")) return "attendees";
  if (pathname.endsWith("/zones")) return "zones";
  if (pathname.endsWith("/staff")) return "staff";
  if (pathname.endsWith("/badge")) return "badge";
  return "overview";
}

export function EventWorkspaceLayout() {
  const { t, i18n } = useTranslation();
  const { eventId } = routeApi.useParams();
  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });
  const readiness = useEventReadiness(eventId);
  const active = useActiveRailTab();
  const [launchDialogOpen, setLaunchDialogOpen] = React.useState(false);

  if (eventQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-body text-destructive">{t("workspaceLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/">{t("workspaceBackHome")}</Link>
        </Button>
      </div>
    );
  }

  const event = eventQuery.data;
  const dateRange = formatDateRange(event, i18n.language);
  const ready = readiness.data?.ready === true;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="text-page-title">{event.name}</h1>
        {dateRange ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-caption text-muted-foreground">{dateRange}</span>
        ) : null}
        <div className="ml-auto">
          {ready ? (
            <Button onClick={() => setLaunchDialogOpen(true)}>{t("workspaceLaunchCheckin")}</Button>
          ) : (
            // Locked state: disabled, but the "locked" reason is real text
            // (sr-only, not just the dimmed/disabled look or the padlock
            // icon alone) so it stays discoverable per WCAG 1.4.1.
            <Button variant="outline" disabled aria-disabled="true">
              <Lock aria-hidden className="size-4" />
              {t("workspaceLaunchCheckin")}
              <span className="sr-only">{t("workspaceCheckinLocked")}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-1">
        <WorkspaceRail eventId={eventId} readiness={readiness.data} active={active} />
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </div>
      <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
        <DialogContent closeLabel={t("workspaceDialogClose")}>
          <DialogHeader>
            <DialogTitle>{t("workspaceLaunchComingSoonTitle")}</DialogTitle>
            <DialogDescription>{t("workspaceLaunchComingSoonBody")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
