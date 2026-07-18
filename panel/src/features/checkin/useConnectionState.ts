// P4.1 Task 10 -- the check-in station's connection/degraded-mode signal.
// StationPage (this task) reads `online` to (1) show the amber "Connection
// is unstable" banner, (2) block a scan/manual-pick from ever reaching the
// network (an explicit "can't check in — offline" state instead), and (3)
// gate the recent-scans rail's Undo/Reprint triggers -- see StationPage.tsx
// and RecentScansRail.tsx's own comments for how each of those three
// reactions is wired. This hook owns ONLY the signal itself: no queueing,
// no retry-on-reconnect side effects of its own (P4.1's spec explicitly
// rules an offline write queue out of scope -- offline ownership stays with
// the kiosks) -- it just observes two existing things and folds them into
// one debounced boolean.
//
// Two independent failure modes, both meaning "a check-in POST right now
// probably won't land":
//  1. The browser itself is offline -- `navigator.onLine` for the initial
//     read, then the window 'online'/'offline' events for changes (the
//     exact same events TanStack Query's own default `onlineManager`
//     listens for -- node_modules/@tanstack/query-core's onlineManager.ts --
//     so this hook's notion of "browser offline" tracks the one that
//     already pauses this app's query fetches).
//  2. The backend is unreachable even though the browser THINKS it has a
//     network path (a captive portal, a downed API host, etc.) -- the
//     check-in actions feed query (Task 5's useCheckinActions, already
//     mounted station-wide via Task 9's rail) already retries (react-query's
//     default `retry: 3`) before its own `isError` flips true, so reading
//     THAT flag is the "isError after a retry" signal the brief calls for,
//     with no separate health-check endpoint to invent.
//
// Debounced (not applied instantly) so a single missed beat -- a stray
// 'offline' event firing right as a tab regains focus, or a query's error
// state settling mid-transition -- can't flap the banner on/off; only a
// signal that's still "not online" DEBOUNCE_MS later is trusted.
import * as React from "react";
import { useCheckinActions } from "./hooks";

export interface UseConnectionStateResult {
  online: boolean;
}

// Not specified as an exact value by the brief ("debounced to avoid
// flapping") -- 400ms is long enough to absorb a single blip but short
// enough that a genuine outage still shows the banner promptly relative to
// a human operator's own reaction time.
const DEBOUNCE_MS = 400;

// PR #77 bot-review round, Finding J -- without a recurring poll, `online`
// only reacts to the INITIAL useCheckinActions fetch plus navigator.onLine
// events: if the backend goes down mid-shift while the browser still
// reports itself online, the degraded banner/action-disabling never
// activates unless some UNRELATED refetch (a window focus, another
// operator's mutation invalidating this same query) happens to occur. This
// periodic `refetch()` keeps the health signal honest on its own. Matches
// useHeartbeat's own 20s precedent (this feature's established interval for
// a lightweight, non-aggressive background ping) rather than inventing a
// new cadence.
const HEALTH_POLL_INTERVAL_MS = 20_000;

function readNavigatorOnline(): boolean {
  return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? true : navigator.onLine;
}

export function useConnectionState(eventId: string): UseConnectionStateResult {
  // Same query Task 9's rail already mounts -- TanStack Query shares one
  // cache entry per query key across every observer, so this adds no extra
  // network traffic, just a second subscriber to the SAME feed's isError.
  const actionsQuery = useCheckinActions(eventId);

  const [browserOnline, setBrowserOnline] = React.useState(readNavigatorOnline);

  React.useEffect(() => {
    function handleOnline() {
      setBrowserOnline(true);
    }
    function handleOffline() {
      setBrowserOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Read the latest `refetch` on every tick without re-subscribing the
  // interval effect below to its identity churn -- same ref-mirrors-latest-
  // callback idiom useHeartbeat.ts/useScanInput.ts already establish in this
  // feature (a fresh `useQuery` result's `refetch` is a new function
  // reference on every render).
  const refetchRef = React.useRef(actionsQuery.refetch);
  React.useEffect(() => {
    refetchRef.current = actionsQuery.refetch;
  }, [actionsQuery.refetch]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void refetchRef.current();
    }, HEALTH_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const rawOnline = browserOnline && !actionsQuery.isError;

  const [online, setOnline] = React.useState(rawOnline);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => setOnline(rawOnline), DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [rawOnline]);

  return { online };
}
