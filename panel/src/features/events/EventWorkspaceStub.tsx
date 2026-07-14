import { Button, Skeleton } from "@idento/ui";
import { Link, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { $api } from "../../shared/api/query";

// Minimal placeholder for the real event workspace (badges, attendees,
// check-in, etc. — P1.2). Confirms the event exists and is reachable via
// this tenant, shows its name, and offers a way back to Home.
//
// Uses `getRouteApi` with the route's string id ("/_app/events/$eventId" —
// the "_app" pathless layout's id plus this route's "/events/$eventId"
// path) instead of importing the `eventStubRoute` object from
// app/router.tsx. That avoids a circular import between this module and
// router.tsx (which imports this component for its `component:` field)
// while still giving strictly-typed params, since `getRouteApi` resolves
// against the registered route tree by id string, not by object identity.
const routeApi = getRouteApi("/_app/events/$eventId");

export function EventWorkspaceStub() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });

  if (eventQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-body text-destructive">{t("homeLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/">{t("workspaceBackHome")}</Link>
        </Button>
      </div>
    );
  }

  const event = eventQuery.data;

  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <h1 className="text-page-title">{event.name}</h1>
      <p className="text-body text-muted-foreground">{t("workspaceComingSoon")}</p>
      <Button asChild variant="outline">
        <Link to="/">{t("workspaceBackHome")}</Link>
      </Button>
    </div>
  );
}
