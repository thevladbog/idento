import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/ApiError";
import { handleApiError } from "../../shared/api/handleApiError";
import { openSseStream } from "../../shared/api/sseStream";
import { MONITOR_SNAPSHOT_KEY } from "./hooks";

export type MonitorStreamStatus = "connecting" | "live" | "reconnecting" | "error";

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
 * Live monitor SSE client (plan §4.1, P4.2 Task 6). Opens a streaming
 * connection to `GET /api/events/{eventId}/monitor/stream` (documented in
 * openapi.yaml by Task 4) via `shared/api/sseStream.ts`'s `openSseStream`
 * and reacts to the decoded frames it dispatches. That helper -- not this
 * hook -- deliberately bypasses the generated `$api`/`openapi-fetch` client
 * (AGENTS.md's usual "never call fetch directly" rule): openapi-fetch has no
 * streaming-body mode, and the plan explicitly designed this transport
 * around raw `fetch` + `res.body.getReader()` (plan-time fact 6, which
 * exports `getApiBaseUrl` from http.ts specifically "for the fetch-streaming
 * client rather than re-deriving"). PR #81 round-2 convergence Finding 3
 * moved that raw `fetch` call itself out of this hook and behind
 * `openSseStream` -- this hook has zero direct `fetch` references now, only
 * the shared transport does, and this file owns exclusively the
 * state-machine logic below (statuses, backoff, coalescing, resync-on-hello,
 * terminal-4xx stop). The endpoint itself is still fully documented; only
 * the transport differs.
 *
 * Frame handling:
 *  - "hello" -- the very first frame the backend sends on every connection
 *    (`monitor_stream.go`) -- flips `status` to "live", resets the backoff
 *    `attempt` ladder (PR #81 bot round Finding C4 -- NOT a bare 200; an
 *    endpoint that accepts the connection and then immediately closes it
 *    without ever sending hello must keep climbing the ladder, not get
 *    hammered at the 1s base forever), and schedules a coalesced snapshot
 *    resync (Finding C5 -- on EVERY hello, not just a reconnect's: a
 *    mutation landing between the page's initial GET and THIS connection's
 *    subscribe registration has no "update" subscriber to notify it).
 *  - "update" -- a thin ping carrying no payload the client needs --
 *    invalidates Task 5's `MONITOR_SNAPSHOT_KEY`, coalesced per
 *    `COALESCE_MS` above, so whatever's rendering `useMonitorSnapshot`
 *    re-reads the real state.
 *  - ": ping" keep-alive comments never reach here at all -- `createSseParser`
 *    swallows comment-only frames before they'd ever call back.
 *
 * On a clean close, a network error, or a RETRYABLE non-OK response (5xx --
 * an overloaded/restarting backend, the same class of failure a network
 * error is), `status` flips to "reconnecting" and this retries with
 * `backoffDelayMs` above.
 *
 * A non-OK response in the 4xx range is instead TERMINAL (PR #81 bot round +
 * CodeRabbit Finding C3): it's normalized into the same `ApiError` shape
 * http.ts's `errors` middleware builds for the `api` client
 * (`apiErrorFromResponse`) and routed through the app's global handling
 * (`handleApiError` -- tenant_suspended suspension takeover, 401 dead-session
 * redirect) exactly like every other API failure, `status` flips to "error",
 * and reconnecting stops -- an expired session or a suspended tenant will
 * never succeed on a bare retry, and looping behind a "reconnecting" badge
 * forever would hide a failure that's either already been surfaced
 * elsewhere or never will resolve itself.
 *
 * No polling fallback (Global Constraints) -- a dead-but-retryable stream is
 * surfaced via `status` for the UI to show a "reconnecting" badge over
 * stale data, not papered over with a poller.
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
      const delay = backoffDelayMs(attempt);
      attempt += 1;
      backoffTimer = setTimeout(() => {
        if (!cancelled) void connect();
      }, delay);
    }

    async function connect() {
      try {
        // openSseStream (shared/api/sseStream.ts) owns the fetch, headers,
        // and reader/decoder/parse loop; it resolves on a clean stream close
        // and throws for everything else (a non-OK response's `ApiError`, a
        // network error, a stream read error, or an abort). This hook reacts
        // to the decoded frames via `onEvent` and owns every state-machine
        // decision below.
        await openSseStream(`/api/events/${eventId}/monitor/stream`, {
          signal: controller.signal,
          onEvent: (evt) => {
            if (evt.event === "hello") {
              // C4: only a "hello" -- proof the stream is actually live, not
              // just that the TCP/HTTP handshake succeeded -- resets the
              // backoff ladder. Resetting on a bare 200 let an endpoint that
              // accepts the connection and then immediately closes it get
              // hammered at the 1s base forever.
              attempt = 0;
              // C5: every hello resyncs the snapshot -- not just a
              // reconnect's. A mutation landing between the page's initial
              // GET /monitor and THIS connection's subscribe registration
              // has no "update" subscriber to notify it, so relying on
              // "update" pings alone can silently lose it. Routed through
              // the SAME trailing coalescer as "update" frames (not fired
              // immediately) so the initial hello -- which lands
              // milliseconds after the page's own initial fetch -- doesn't
              // turn into an instant, redundant second GET; a genuinely
              // racing mutation still surfaces within one coalesce window,
              // and a burst of real "update" pings landing in that same
              // window is absorbed into this same single refetch.
              scheduleInvalidate();
              setStatus("live");
            } else if (evt.event === "update") {
              scheduleInvalidate();
            }
          },
        });

        // The stream closed cleanly (server-side close, e.g. the request
        // context ending) -- not an abort. Reconnect per the same policy as
        // a network error below.
        if (!cancelled) scheduleReconnect();
      } catch (err) {
        // An aborted read (unmount or an eventId change tore down
        // `controller` mid-flight) must NOT be treated as a stream failure
        // -- the scope is gone, there's nothing to reconnect for.
        if (controller.signal.aborted) return;

        if (err instanceof ApiError) {
          // PR #81 bot round + CodeRabbit Finding C3: route through the app's
          // global auth/suspension handling (tenant_suspended takeover, 401
          // dead-session redirect) exactly like every other API failure --
          // openSseStream's transport bypass must not also mean bypassing
          // this.
          handleApiError(err);
          if (err.status >= 400 && err.status < 500) {
            // Terminal: an expired session (401), a suspended tenant (403
            // tenant_suspended -- already actioned above), or any other
            // documented 4xx (400/404/...) will never succeed on a bare
            // retry. Stop climbing the backoff ladder and surface a dead
            // stream instead of looping behind a "reconnecting" badge
            // forever.
            if (!cancelled) setStatus("error");
            return;
          }
          // 5xx: transient (an overloaded/restarting backend) -- same retry
          // policy as a network error below.
        }
        // Every other failure here is retryable (a network error, a stream
        // read error, or a 5xx ApiError above).
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
