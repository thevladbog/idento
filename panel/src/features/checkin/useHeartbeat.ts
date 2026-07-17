// P4.1 Task 12 -- the check-in station's heartbeat lifecycle. Keeps a
// registered station's `last_seen_at` (Task 2's checkin_stations table)
// fresh for as long as StationPage stays mounted, so a later online/offline
// indicator (Task 2's own heartbeatCheckinStation comment: "so the panel can
// show online/offline state") can tell a live station apart from one whose
// tab was closed or crashed.
//
// Fires an immediate heartbeat on mount (a freshly-launched station should
// read as "seen" right away, not up to 20s later), then again every 20s
// (setInterval) for as long as it stays mounted; the interval is cleared on
// unmount. A failed heartbeat (station deleted server-side, a transient
// network blip, etc.) is deliberately non-fatal: this hook calls Task 5's
// useStationHeartbeat mutation via `.mutate()` (never `.mutateAsync()`),
// which -- like every other fire-and-forget `.mutate()` call in this
// codebase -- never throws or rejects into an unhandled promise; the next
// tick simply tries again. Task 10's degraded-mode signal
// (useConnectionState) is what actually surfaces a persistent failure to the
// operator; this hook has no opinion on that, it just keeps trying.
import * as React from "react";
import { useStationHeartbeat } from "./hooks";

// Matches the brief verbatim ("every 20s").
const HEARTBEAT_INTERVAL_MS = 20_000;

export function useHeartbeat(eventId: string, stationId: string | null): void {
  const heartbeat = useStationHeartbeat(eventId);

  // Read the latest mutate function on every tick without re-subscribing
  // the effect below to its identity churn -- the same ref-mirrors-latest-
  // callback idiom useScanInput.ts already establishes in this feature (its
  // own onCodeRef) for exactly this reason: `heartbeat.mutate` is a fresh
  // function reference on every render (a new useMutation instance's bound
  // method), and that must not restart the interval below.
  const mutateRef = React.useRef(heartbeat.mutate);
  React.useEffect(() => {
    mutateRef.current = heartbeat.mutate;
  }, [heartbeat.mutate]);

  React.useEffect(() => {
    // No station registered yet -- nothing to heartbeat for. StationPage's
    // own route guard (searchParams.ts's checkinStationBeforeLoad) means
    // this is never actually true by the time StationPage mounts this hook,
    // but the type this feature threads through everywhere else
    // (useCheckinFlow's stationId, ScanInput's) is `string | null`, so this
    // hook mirrors that rather than assuming a non-null value it can't
    // enforce itself.
    if (!stationId) return;
    // A fresh `const` right after the narrowing guard -- unlike `stationId`
    // itself, TS keeps this bound to `string` inside the nested `beat`
    // closure below (a `string | null` parameter's narrowing doesn't
    // survive into a nested function declaration).
    const activeStationId = stationId;

    function beat() {
      mutateRef.current({ params: { path: { event_id: eventId, id: activeStationId } } });
    }

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [eventId, stationId]);
}
