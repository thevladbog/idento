import { Skeleton, cn } from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ApiKeysCard } from "./ApiKeysCard";
import { DangerZoneCard } from "./DangerZoneCard";
import { FontsCard } from "./FontsCard";
import { GeneralCard } from "./GeneralCard";
import { $api } from "../../../shared/api/query";
import { useScrollSpy } from "../../../shared/hooks/useScrollSpy";

// Same rationale as WorkspaceOverview.tsx: `getRouteApi` with the ancestor
// layout route's string id avoids a circular import with app/router.tsx.
const routeApi = getRouteApi("/_app/events/$eventId");

const SECTION_IDS = ["settings-general", "settings-fonts", "settings-api-keys", "settings-danger"] as const;

const RAIL_ITEMS: { id: (typeof SECTION_IDS)[number]; labelKey: string; destructive?: boolean }[] = [
  { id: "settings-general", labelKey: "settingsGeneral" },
  { id: "settings-fonts", labelKey: "settingsFonts" },
  { id: "settings-api-keys", labelKey: "settingsApiKeys" },
  { id: "settings-danger", labelKey: "settingsDanger", destructive: true },
];

// Board 6a — the event settings page: a left anchor rail (scroll-spy
// active-highlighting via the ported useScrollSpy) beside stacked card
// sections. General, Fonts and API keys are real; Danger zone is an inline
// placeholder that Task 7 replaces (reconciliation #5 in the task brief
// narrows the board's 7-item rail down to these 4).
export function EventSettingsPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const activeId = useScrollSpy([...SECTION_IDS]);
  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });

  if (eventQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-3xl" />
      </div>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return <p className="text-body text-destructive">{t("settingsLoadError")}</p>;
  }

  const event = eventQuery.data;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-page-title">{t("settingsTitle")}</h2>
      <div className="flex gap-6">
        <nav className="flex w-[200px] shrink-0 flex-col gap-0.5">
          {RAIL_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={activeId === item.id ? "true" : undefined}
              className={cn(
                "rounded-md px-2 py-1.5 text-body",
                item.destructive
                  ? "text-destructive"
                  : activeId === item.id
                    ? "bg-success/10 text-success"
                    : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(item.labelKey)}
            </a>
          ))}
        </nav>
        <div className="flex max-w-3xl flex-1 flex-col gap-4">
          <section id="settings-general">
            <GeneralCard event={event} />
          </section>
          <section id="settings-fonts">
            <FontsCard eventId={event.id} />
          </section>
          <section id="settings-api-keys">
            <ApiKeysCard eventId={event.id} />
          </section>
          <section id="settings-danger">
            <DangerZoneCard event={event} />
          </section>
        </div>
      </div>
    </div>
  );
}
