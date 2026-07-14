import { Button, Skeleton } from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { eventStubRoute } from "../../app/router";
import { $api } from "../../shared/api/query";

// Minimal placeholder for the real event workspace (badges, attendees,
// check-in, etc. — P1.2). Confirms the event exists and is reachable via
// this tenant, shows its name, and offers a way back to Home.
//
// Imports `eventStubRoute` back from app/router.tsx (which imports this
// component for its own `component:` field) — a circular import, but a safe
// one: `eventStubRoute` is only read inside the component function body, by
// which point both modules have finished evaluating. `.useParams()` on the
// route object itself gives strictly-typed params without needing a
// string-literal `from` id (which would otherwise have to be the router's
// internal "/_app/events/$eventId" id, not the "/events/$eventId" path
// `Link`'s `to` prop uses — pathless layout routes like `_app` add an id
// segment but no URL segment).
export function EventWorkspaceStub() {
  const { t } = useTranslation();
  const { eventId } = eventStubRoute.useParams();
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
