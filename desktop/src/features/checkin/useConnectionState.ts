// Two independent failure modes, folded into one debounced boolean: (1) the
// browser itself is offline (navigator.onLine + window online/offline
// events), (2) the backend is unreachable even though the browser thinks it
// has a network path -- read off the SAME checkin-actions feed query every
// other consumer already mounts (its own retries settle isError). Debounced
// 400ms so a single missed beat can't flap the banner on/off. A 20s
// self-refetch keeps the signal honest even with no other observer forcing
// a refetch.
import { useEffect, useRef, useState } from "react";
import { useCheckinActions } from "./hooks";

export interface UseConnectionStateResult {
  online: boolean;
}

const DEBOUNCE_MS = 400;
const HEALTH_POLL_INTERVAL_MS = 20_000;

function readNavigatorOnline(): boolean {
  return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? true : navigator.onLine;
}

export function useConnectionState(eventId: string): UseConnectionStateResult {
  const actionsQuery = useCheckinActions(eventId);

  const [browserOnline, setBrowserOnline] = useState(readNavigatorOnline);

  useEffect(() => {
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

  const refetchRef = useRef(actionsQuery.refetch);
  useEffect(() => {
    refetchRef.current = actionsQuery.refetch;
  }, [actionsQuery.refetch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refetchRef.current();
    }, HEALTH_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const rawOnline = browserOnline && !actionsQuery.isError;

  const [online, setOnline] = useState(rawOnline);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setOnline(rawOnline), DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [rawOnline]);

  return { online };
}
