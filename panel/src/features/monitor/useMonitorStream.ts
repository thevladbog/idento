import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "../../shared/api/http";
import { getToken } from "../../shared/api/session";
import { MONITOR_SNAPSHOT_KEY } from "./hooks";
import { createSseParser } from "./parseSse";

export type MonitorStreamStatus = "connecting" | "live" | "reconnecting";

// Thin-ping SSE (plan §4.1, Global Constraints): the backend's "update"
// frames carry no state, so every one of them just needs to trigger a
// re-read of the snapshot -- but a burst of frames (several check-ins
// landing within the same second) must not turn into a burst of refetches.
// This caps invalidation at 1/sec via a TRAILING-edge coalesce: the first
// update in a quiet window starts a timer; every update that lands before
// the timer fires is absorbed for free; the timer's firing is the ONE
// invalidation for the whole burst.
const COALESCE_MS = 1_000;

// Exponential backoff for reconnects, per the plan verbatim: 1s base, x2
// each attempt, capped at 30s, +/-25% jitter so many clients reconnecting
// after a shared outage don't all hammer the backend in lockstep.
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const BACKOFF_JITTER_RATIO = 0.25;

function backoffDelayMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  const jitter = base * BACKOFF_JITTER_RATIO * (Math.random() * 2 - 1); // +/-25%
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Live monitor SSE client (plan §4.1, P4.2 Task 6). Opens a fetch-streaming
 * connection to `GET /api/events/{eventId}/monitor/stream` (documented in
 * openapi.yaml by Task 4) and feeds decoded chunks into Task 5's
 * `createSseParser`. This deliberately bypasses the generated `$api`/
 * `openapi-fetch` client (AGENTS.md's usual "never call fetch directly"
 * rule) -- openapi-fetch has no streaming-body mode, and the plan explicitly
 * designed this hook around raw `fetch` + `res.body.getReader()` (plan-time
 * fact 6, which exports `getApiBaseUrl` from http.ts specifically "for the
 * fetch-streaming client rather than re-deriving"). The endpoint itself is
 * still fully documented; only the transport differs.
 *
 * Frame handling:
 *  - "hello" -- the very first frame the backend sends on every connection
 *    (`monitor_stream.go`) -- flips `status` to "live".
 *  - "update" -- a thin ping carrying no payload the client needs --
 *    invalidates Task 5's `MONITOR_SNAPSHOT_KEY`, coalesced per
 *    `COALESCE_MS` above, so whatever's rendering `useMonitorSnapshot`
 *    re-reads the real state.
 *  - ": ping" keep-alive comments never reach here at all -- `createSseParser`
 *    swallows comment-only frames before they'd ever call back.
 *
 * On any disconnect (a clean close, a network error, or a non-OK response)
 * `status` flips to "reconnecting" and this retries with `backoffDelayMs`
 * above. A successful reconnect (the retried fetch resolves OK -- BEFORE
 * that connection's own "hello" frame even arrives) immediately invalidates
 * the snapshot too: the resync guarantee that whatever changed while
 * disconnected must not wait for the next "update" ping to surface.
 *
 * No polling fallback (Global Constraints) -- a dead stream is surfaced via
 * `status` for the UI to show a "reconnecting" badge over stale data, not
 * papered over with a poller.
 */
export function useMonitorStream(eventId: string): { status: MonitorStreamStatus } {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<MonitorStreamStatus>("connecting");

  React.useEffect(() => {
    // Full reset on every effect run -- both a genuine mount AND an eventId
    // change (P4.1 round-3 Finding 5's lesson: a scope change must reset
    // ALL local state, not layer a new fetch on top of stale flags). Every
    // mutable variable below lives inside this effect's closure, so a fresh
    // run gets fresh values for free; the cleanup at the bottom tears down
    // the OLD scope's controller/timers before React commits this one.
    setStatus("connecting");

    const controller = new AbortController();
    let cancelled = false;
    let attempt = 0;
    let isReconnect = false;
    let coalescePending = false;
    let backoffTimer: ReturnType<typeof setTimeout> | undefined;
    let coalesceTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleInvalidate() {
      if (coalescePending) return;
      coalescePending = true;
      coalesceTimer = setTimeout(() => {
        coalescePending = false;
        void queryClient.invalidateQueries({ queryKey: MONITOR_SNAPSHOT_KEY(eventId) });
      }, COALESCE_MS);
    }

    function scheduleReconnect() {
      if (cancelled) return;
      setStatus("reconnecting");
      isReconnect = true;
      const delay = backoffDelayMs(attempt);
      attempt += 1;
      backoffTimer = setTimeout(() => {
        if (!cancelled) void connect();
      }, delay);
    }

    async function connect() {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      try {
        const res = await fetch(`${getApiBaseUrl()}/api/events/${eventId}/monitor/stream`, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`monitor stream request failed with status ${res.status}`);
        }

        // A successful (re)connect resets the backoff ladder, and -- if
        // this was a reconnect -- fires the resync invalidation right away,
        // before this connection's own "hello" frame even arrives. The
        // "live" transition below is a separate signal (the parser is
        // actually caught up), not just that the socket opened.
        attempt = 0;
        if (isReconnect) {
          void queryClient.invalidateQueries({ queryKey: MONITOR_SNAPSHOT_KEY(eventId) });
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const feed = createSseParser((evt) => {
          if (evt.event === "hello") {
            setStatus("live");
          } else if (evt.event === "update") {
            scheduleInvalidate();
          }
        });

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          feed(decoder.decode(value, { stream: true }));
        }

        // The stream closed cleanly (server-side close, e.g. the request
        // context ending) -- not an abort. Reconnect per the same policy as
        // a network error below.
        if (!cancelled) scheduleReconnect();
      } catch {
        // An aborted read (unmount or an eventId change tore down
        // `controller` mid-flight) must NOT be treated as a stream failure
        // -- the scope is gone, there's nothing to reconnect for.
        if (controller.signal.aborted) return;
        if (!cancelled) scheduleReconnect();
      }
    }

    void connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (backoffTimer !== undefined) clearTimeout(backoffTimer);
      if (coalesceTimer !== undefined) clearTimeout(coalesceTimer);
    };
  }, [eventId, queryClient]);

  return { status };
}
