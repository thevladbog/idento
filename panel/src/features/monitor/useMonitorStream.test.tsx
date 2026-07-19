// P4.2 Task 6 -- useMonitorStream tests. Test matrix per task-6-brief.md:
// connect->hello->live; update->invalidated (subscribed-observer refetch,
// the house idiom -- hooks.test.tsx's MONITOR_SNAPSHOT_KEY describe block);
// 3 updates within 300ms -> exactly 1 extra snapshot fetch (coalescing);
// stream close -> reconnecting -> next connect attempt observed + immediate
// refetch on success; unmount aborts (no further fetches); eventId change
// closes the old stream and opens the new URL.
//
// PR #81 bot round: extended for Findings C3/C4/C5 (see this file's sibling
// useMonitorStream.ts for the full state-machine rationale) --
//  - C3: a non-OK stream response (401/403 tenant_suspended/other 4xx) is
//    terminal -- status flips to "error", no further reconnect, and the
//    failure is routed through the app's global handling (handleApiError.ts)
//    the exact same way every other API failure is. 5xx and network errors
//    keep the pre-existing backoff loop.
//  - C4: the backoff `attempt` counter now resets only once a "hello" frame
//    actually arrives, not as soon as the connect's fetch resolves OK -- an
//    endpoint that 200s and then immediately closes without ever sending
//    hello must keep climbing the ladder.
//  - C5: every "hello" -- not just a reconnect's -- resyncs the snapshot,
//    routed through the SAME trailing coalescer as "update" frames.
//
// Real timers throughout (never fake) -- this feature's repeatedly-
// documented convention, since fake timers + MSW streaming is exactly the
// interaction the codebase avoids (see this file's sibling task briefs and
// useHeartbeat.test.tsx's own comment on the one hook where the fake clock
// WAS judged worth the risk; a raw ReadableStream body is a strictly harder
// case than that hook's plain JSON mutation, so real timers + bounded
// `waitFor`s here instead). The exponential backoff test therefore waits
// out one real ~1s(+/-25%) backoff window -- bounded via `waitFor`'s own
// `timeout` option, never an unbounded `await`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { getToken, saveSession } from "../../shared/api/session";
import { tenantStatusStore } from "../../shared/tenant-status/tenantStatusStore";
import { useMonitorSnapshot } from "./hooks";
import { useMonitorStream } from "./useMonitorStream";

const AUTH = {
  token: "jwt-test",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme" }],
  current_tenant: { id: "t1", name: "Acme" },
};

// Same "delete + replace the whole `location` object" idiom
// queryClient.test.ts uses -- jsdom's Location is a special exotic object
// whose own properties aren't configurable, so `vi.spyOn` on `.assign`
// throws "Cannot redefine property".
const realLocation = window.location;

function mockLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  // @ts-expect-error -- intentionally deleting a non-optional global for the mock swap
  delete window.location;
  window.location = { ...realLocation, assign } as Location;
  return assign;
}

function restoreLocation(): void {
  window.location = realLocation;
}

// ---------------------------------------------------------------------------
// Deferred/controlled SSE stream helper. Each `monitor/stream` GET the hook
// makes (the initial connect AND every reconnect) is a SEPARATE HTTP request
// MSW intercepts, resolved with its OWN ReadableStream this test drives by
// hand -- the same "manually-controlled deferred, released only after
// asserting the intermediate state" idiom StationPage.test.tsx's printer-
// waiting test uses for a regular JSON response (see that file's own
// comment, "PR #77 bot-review round 3, Finding 7"), applied here to a
// streaming body per the plan's own precedent note ("MSW v2.15, streaming
// ReadableStream bodies supported").
// ---------------------------------------------------------------------------
function makeSseStream() {
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    push(frame: string) {
      controllerRef.enqueue(encoder.encode(frame));
    },
    close() {
      controllerRef.close();
    },
    error(err: unknown = new Error("stream error")) {
      controllerRef.error(err);
    },
  };
}

type Connection = ReturnType<typeof makeSseStream> & { url: string; authHeader: string | null };

let connections: Connection[] = [];
let snapshotGetCount = 0;

function snapshotBody() {
  return {
    totals: { checked_in: 0, total: 0, rate_per_min: 0, peak: null, est_done_at: null },
    zones: [],
    unattributed: 0,
    stations: [],
    recent: [],
  };
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/monitor/stream", ({ request }) => {
    const conn = makeSseStream() as Connection;
    conn.url = request.url;
    conn.authHeader = request.headers.get("authorization");
    connections.push(conn);
    return new HttpResponse(conn.stream, { headers: { "Content-Type": "text/event-stream" } });
  }),
  http.get("http://api.test/api/events/:eventId/monitor", () => {
    snapshotGetCount += 1;
    return HttpResponse.json(snapshotBody());
  }),
);
void server;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

// Renders both the stream hook AND a SUBSCRIBED useMonitorSnapshot observer
// on the SAME QueryClient -- the house idiom for proving invalidation
// actually happened (hooks.test.tsx's MONITOR_SNAPSHOT_KEY describe block):
// count the observer's own refetches rather than spying on
// invalidateQueries.
function Harness({ eventId }: { eventId: string }) {
  const streamState = useMonitorStream(eventId);
  useMonitorSnapshot(eventId);
  return <div data-testid="status">{streamState.status}</div>;
}

describe("useMonitorStream", () => {
  beforeEach(() => {
    connections = [];
    snapshotGetCount = 0;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("connects, requests with the auth header, and transitions connecting -> live once the hello frame arrives", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    expect(result.current.status).toBe("connecting");
    await waitFor(() => expect(connections.length).toBe(1));
    expect(connections[0].url).toBe("http://api.test/api/events/evt-1/monitor/stream");
    expect(connections[0].authHeader).toBe("Bearer jwt-test");

    connections[0].push("event: hello\ndata: {}\n\n");

    await waitFor(() => expect(result.current.status).toBe("live"));
  });

  it("invalidates the snapshot query when an update frame arrives, so a subscribed observer refetches", async () => {
    const { Wrapper } = makeWrapper();
    const { getByTestId } = render(<Harness eventId="evt-1" />, { wrapper: Wrapper });

    await waitFor(() => expect(snapshotGetCount).toBe(1)); // useMonitorSnapshot's own initial fetch
    await waitFor(() => expect(connections.length).toBe(1));
    connections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(getByTestId("status")).toHaveTextContent("live"));

    connections[0].push('event: update\ndata: {"at":"2026-07-18T00:00:00Z"}\n\n');

    await waitFor(() => expect(snapshotGetCount).toBe(2), { timeout: 2000 });
  });

  it(
    "resyncs the snapshot on the INITIAL hello alone -- C5: not just a reconnect's, and with no update frame needed",
    async () => {
      const { Wrapper } = makeWrapper();
      const { getByTestId } = render(<Harness eventId="evt-1" />, { wrapper: Wrapper });

      await waitFor(() => expect(snapshotGetCount).toBe(1)); // the page's own initial GET /monitor
      await waitFor(() => expect(connections.length).toBe(1));
      connections[0].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("live"));

      // A mutation landing between that initial GET and this connection's
      // subscribe registration would have no "update" subscriber to notify
      // it -- the hello itself must resync, closing that race even when NO
      // update frame ever arrives. Routed through the same 1s trailing
      // coalescer as "update" frames (COALESCE_MS in useMonitorStream.ts),
      // so this lands up to ~1s after hello, not instantly.
      await waitFor(() => expect(snapshotGetCount).toBe(2), { timeout: 2000 });
    },
    5000,
  );

  it("coalesces a burst of update frames within the same window into exactly one extra snapshot fetch", async () => {
    const { Wrapper } = makeWrapper();
    render(<Harness eventId="evt-1" />, { wrapper: Wrapper });

    await waitFor(() => expect(snapshotGetCount).toBe(1));
    await waitFor(() => expect(connections.length).toBe(1));
    connections[0].push("event: hello\ndata: {}\n\n");
    // C5: hello itself now schedules a coalesced resync too (asserted in
    // its own test above) -- the burst below lands well inside that SAME
    // 1s window, so it's still exactly ONE extra fetch overall, not two.

    connections[0].push('event: update\ndata: {"at":"t1"}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    connections[0].push('event: update\ndata: {"at":"t2"}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    connections[0].push('event: update\ndata: {"at":"t3"}\n\n');
    // All three landed within ~300ms -- well inside the 1s coalescing
    // window (COALESCE_MS in useMonitorStream.ts).

    await waitFor(() => expect(snapshotGetCount).toBe(2), { timeout: 3000 });
    // Give it a further beat to make sure the burst didn't ALSO schedule a
    // second/third invalidation that lands later.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(snapshotGetCount).toBe(2);
  });

  it(
    "reconnects with backoff after a clean stream close, and resyncs on the RECONNECT's own hello -- not on the bare reconnect fetch resolving OK",
    async () => {
      const { Wrapper } = makeWrapper();
      const { getByTestId } = render(<Harness eventId="evt-1" />, { wrapper: Wrapper });

      await waitFor(() => expect(snapshotGetCount).toBe(1));
      await waitFor(() => expect(connections.length).toBe(1));
      connections[0].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("live"));
      // The initial hello's own coalesced resync (C5) lands here.
      await waitFor(() => expect(snapshotGetCount).toBe(2), { timeout: 2000 });

      connections[0].close();

      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("reconnecting"));

      // Backoff is 1s base +/-25% jitter (max 1250ms) -- bounded wait for
      // the retried connect() to land as a brand-new request.
      await waitFor(() => expect(connections.length).toBe(2), { timeout: 3000 });

      // C4/C5: resync is gated on THIS connection's own hello, not on the
      // reconnect's fetch merely resolving OK -- no new invalidation yet.
      expect(snapshotGetCount).toBe(2);

      connections[1].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("live"));
      await waitFor(() => expect(snapshotGetCount).toBe(3), { timeout: 2000 });
    },
    8000,
  );

  it("aborts on unmount -- no further connect attempts", async () => {
    const { Wrapper } = makeWrapper();
    const { result, unmount } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(connections.length).toBe(1));
    connections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(result.current.status).toBe("live"));

    unmount();

    // Past one full backoff window (max 1250ms) -- if the abort were
    // mistaken for a stream failure, a second connection would appear here.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(connections.length).toBe(1);
  });

  it("closes the old stream and opens a new one when eventId changes, with a full status reset", async () => {
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(({ eventId }) => useMonitorStream(eventId), {
      wrapper: Wrapper,
      initialProps: { eventId: "evt-1" },
    });

    await waitFor(() => expect(connections.length).toBe(1));
    expect(connections[0].url).toBe("http://api.test/api/events/evt-1/monitor/stream");
    connections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(result.current.status).toBe("live"));

    rerender({ eventId: "evt-2" });

    // Full reset per the P4.1 round-3 lesson -- not a leftover "live".
    expect(result.current.status).toBe("connecting");
    await waitFor(() => expect(connections.length).toBe(2));
    expect(connections[1].url).toBe("http://api.test/api/events/evt-2/monitor/stream");

    connections[1].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(result.current.status).toBe("live"));

    // The old (evt-1) stream must no longer be driving state -- closing it
    // now must not flip status back to "reconnecting".
    connections[0].close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe("live");
    expect(connections.length).toBe(2);
  });
});

// PR #81 bot round Finding C4: `attempt` used to reset to 0 as soon as the
// connect's fetch resolved OK -- BEFORE the stream proved itself live via
// an actual "hello" frame. An endpoint that accepts the connection and then
// immediately closes it (no hello ever sent) got hammered at the 1s backoff
// base forever instead of climbing the ladder.
describe("useMonitorStream -- backoff attempt reset (C4)", () => {
  beforeEach(() => {
    connections = [];
    snapshotGetCount = 0;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it(
    "keeps the backoff attempt counter climbing across repeated OK-but-no-hello closes, instead of resetting on every bare 200",
    async () => {
      const { Wrapper } = makeWrapper();
      renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

      await waitFor(() => expect(connections.length).toBe(1));
      const t0 = Date.now();
      connections[0].close(); // 200 OK, closes immediately, no hello -- attempt must NOT reset.

      await waitFor(() => expect(connections.length).toBe(2), { timeout: 3000 });
      const t1 = Date.now();
      const firstGapMs = t1 - t0;

      connections[1].close(); // second OK-but-no-hello close -- attempt should now be 1, not reset back to 0.

      await waitFor(() => expect(connections.length).toBe(3), { timeout: 5000 });
      const t2 = Date.now();
      const secondGapMs = t2 - t1;

      // backoffDelayMs(0) draws from [750, 1250]ms and backoffDelayMs(1)
      // from [1500, 2500]ms (base*2^attempt +/-25% jitter, non-overlapping
      // ranges) -- so this lower bound is a robust, non-flaky discriminator
      // between "reset every time" (the bug -- second gap would also fall
      // in [750, 1250]) and "reset only on hello" (the fix). Also captures
      // the earlier review's own missing lower-bound assertion (the burst
      // test above only ever asserted an UPPER bound via `waitFor` timeouts).
      expect(secondGapMs).toBeGreaterThan(1300);
      expect(secondGapMs).toBeGreaterThan(firstGapMs);
    },
    10000,
  );
});

// PR #81 bot round Findings C3 (+ CodeRabbit): a non-OK stream response used
// to be treated identically to a network error -- infinite reconnect behind
// a "reconnecting" badge, even for a 401 (expired session) or 403
// tenant_suspended, which should instead trigger the app's global handling
// (queryClient.ts's handleApiError, now shared via handleApiError.ts) the
// same way every other API failure does. 5xx and genuine network errors
// keep the pre-existing backoff loop -- those ARE expected to eventually
// succeed on retry.
describe("useMonitorStream -- terminal vs retryable stream failures (C3)", () => {
  beforeEach(() => {
    connections = [];
    snapshotGetCount = 0;
    localStorage.clear();
    tenantStatusStore.setSuspended(false);
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  afterEach(() => {
    restoreLocation();
    tenantStatusStore.setSuspended(false);
  });

  it("stops retrying and surfaces status 'error' on a 401, clearing the session and redirecting to /login", async () => {
    saveSession(AUTH);
    const assign = mockLocationAssign();
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor/stream", () =>
        HttpResponse.json({ error: "Session expired" }, { status: 401 }),
      ),
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(getToken()).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login");

    // Past one full backoff window -- a terminal 4xx must never retry.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(connections.length).toBe(0); // handled before any streaming `connections` entry would be pushed
    expect(result.current.status).toBe("error");
  }, 5000);

  it("stops retrying and surfaces status 'error' on a 403 tenant_suspended, marking the tenant suspended", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor/stream", () =>
        HttpResponse.json({ code: "tenant_suspended", error: "Tenant is suspended" }, { status: 403 }),
      ),
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(tenantStatusStore.isSuspended()).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(result.current.status).toBe("error");
  }, 5000);

  it("stops retrying and surfaces status 'error' on a documented 404 with no matching global handler", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor/stream", () => new HttpResponse(null, { status: 404 })),
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(result.current.status).toBe("error");
  }, 5000);

  it("keeps retrying (never surfaces 'error') on a 500", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor/stream", () => new HttpResponse(null, { status: 500 })),
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("reconnecting"), { timeout: 3000 });
    expect(result.current.status).not.toBe("error");
  }, 5000);

  it("keeps retrying (never surfaces 'error') on a plain network error", async () => {
    server.use(http.get("http://api.test/api/events/:eventId/monitor/stream", () => HttpResponse.error()));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorStream("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("reconnecting"), { timeout: 3000 });
    expect(result.current.status).not.toBe("error");
  }, 5000);
});
