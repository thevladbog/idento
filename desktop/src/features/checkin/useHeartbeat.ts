// Keeps a registered station's last_seen_at fresh for as long as this hook
// stays mounted: an immediate heartbeat on mount, then every 20s. A failed
// heartbeat is non-fatal (fire-and-forget `.mutate()`) -- useConnectionState
// owns surfacing a persistent failure, this hook just keeps trying.
import { useEffect, useRef } from "react";
import { useStationHeartbeat } from "./hooks";

const HEARTBEAT_INTERVAL_MS = 20_000;

export function useHeartbeat(eventId: string, stationId: string | null): void {
  const heartbeat = useStationHeartbeat(eventId);

  const mutateRef = useRef(heartbeat.mutate);
  useEffect(() => {
    mutateRef.current = heartbeat.mutate;
  }, [heartbeat.mutate]);

  useEffect(() => {
    if (!stationId) return;
    const activeStationId = stationId;

    function beat() {
      mutateRef.current(activeStationId);
    }

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [eventId, stationId]);
}
