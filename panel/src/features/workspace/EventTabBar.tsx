import { TabBar, TabBarItem } from "@idento/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, LayoutGrid, MoreHorizontal, Search, Users } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreSheet } from "./MoreSheet";
import { $api } from "../../shared/api/query";
import { stationStaleness } from "../monitor/liveness";

// Recheck cadence for the cache-only attention dot below — well under
// STATION_STALE_MS (45s) so a station crossing the threshold lights the
// dot promptly even if nothing else re-renders this component, but coarse
// enough to stay a trivial local recompute (no network — see the dot's own
// comment).
const STALENESS_RECHECK_MS = 10_000;

type EventTab = "overview" | "monitor" | "attendees" | "staff" | "other";

// Same pathname-suffix idiom as EventWorkspaceLayout's useActiveRailTab —
// monitor is a rail-less TOP-LEVEL sibling route, which is exactly why this
// bar derives active state from the pathname instead of workspace-child
// route matching.
function useActiveEventTab(): EventTab {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/monitor")) return "monitor";
  if (pathname.endsWith("/attendees")) return "attendees";
  if (pathname.endsWith("/staff")) return "staff";
  if (/\/events\/[^/]+\/?$/.test(pathname)) return "overview";
  return "other";
}

// Board 8a — the phone workspace nav. Self-hiding chrome: fixed to the
// bottom edge, `md:hidden`, so desktop keeps the rail untouched. Mounted by
// EventWorkspaceLayout AND MonitorPage (monitor renders outside the
// workspace layout but must keep the floor loop reachable — board 8f).
export function EventTabBar({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const active = useActiveEventTab();
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Board 8a — the Monitor tab's attention dot ("needs a look", never a
  // count): lights when the monitor snapshot ALREADY IN CACHE reports a
  // stale station. Cache-only by design (`enabled: false`): the tab bar
  // renders on every workspace page and must never generate monitor
  // traffic itself — the dot updates whenever the monitor page or Home's
  // LiveStrip refreshes the shared snapshot.
  const snapshot = $api.useQuery(
    "get",
    "/api/events/{event_id}/monitor",
    { params: { path: { event_id: eventId } } },
    { enabled: false },
  );
  // A station can cross STATION_STALE_MS purely by the clock advancing,
  // with no cache update at all (e.g. sitting on Overview with nothing
  // else re-rendering this bar) — without a local recheck, the dot would
  // stay off until some unrelated re-render happened to notice. This tick
  // is purely local re-render bookkeeping, never a fetch: `enabled: false`
  // above is untouched, so network behavior is unchanged.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), STALENESS_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const hasStaleStation = (snapshot.data?.stations ?? []).some(
    (station) => station.last_seen_at && stationStaleness(station.last_seen_at, now).stale,
  );

  return (
    <>
      <TabBar label={t("tabBarLabel")} className="fixed inset-x-0 bottom-0 z-40 md:hidden">
        <Link
          to="/events/$eventId"
          params={{ eventId }}
          activeOptions={{ exact: true }}
          aria-current={active === "overview" ? "page" : undefined}
          className="flex flex-1"
        >
          <TabBarItem icon={LayoutGrid} label={t("tabBarOverview")} active={active === "overview"} />
        </Link>
        {/* exact on every tab link: TanStack Link's own prefix-matching would
            re-inject aria-current="page" on nested child paths (P6.3) where
            useActiveEventTab() reports "other" — keep both sources agreeing. */}
        <Link
          to="/events/$eventId/monitor"
          params={{ eventId }}
          activeOptions={{ exact: true }}
          aria-current={active === "monitor" ? "page" : undefined}
          className="flex flex-1"
        >
          <TabBarItem
            icon={Activity}
            label={t("tabBarMonitor")}
            active={active === "monitor"}
            badge={hasStaleStation ? t("tabBarMonitorAttention") : undefined}
          />
        </Link>
        <Link
          to="/events/$eventId/attendees"
          params={{ eventId }}
          activeOptions={{ exact: true }}
          aria-current={active === "attendees" ? "page" : undefined}
          className="flex flex-1"
        >
          <TabBarItem icon={Search} label={t("tabBarAttendees")} active={active === "attendees"} />
        </Link>
        <Link
          to="/events/$eventId/staff"
          params={{ eventId }}
          activeOptions={{ exact: true }}
          aria-current={active === "staff" ? "page" : undefined}
          className="flex flex-1"
        >
          <TabBarItem icon={Users} label={t("tabBarStaff")} active={active === "staff"} />
        </Link>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className="flex flex-1"
        >
          <TabBarItem icon={MoreHorizontal} label={t("tabBarMore")} />
        </button>
      </TabBar>
      <MoreSheet eventId={eventId} open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
