// P4.2 Task 6 -- useMonitorStream tests. Test matrix per task-6-brief.md:
// connect->hello->live; update->invalidated (subscribed-observer refetch,
// the house idiom -- hooks.test.tsx's MONITOR_SNAPSHOT_KEY describe block);
// 3 updates within 300ms -> exactly 1 extra snapshot fetch (coalescing);
// stream close -> reconnecting -> next connect attempt observed + immediate
// refetch on success; unmount aborts (no further fetches); eventId change
// closes the old stream and opens the new URL.
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
import { useMonitorSnapshot } from "./hooks";
import { useMonitorStream } from "./useMonitorStream";

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

  it("coalesces a burst of update frames within the same window into exactly one extra snapshot fetch", async () => {
    const { Wrapper } = makeWrapper();
    render(<Harness eventId="evt-1" />, { wrapper: Wrapper });

    await waitFor(() => expect(snapshotGetCount).toBe(1));
    await waitFor(() => expect(connections.length).toBe(1));
    connections[0].push("event: hello\ndata: {}\n\n");
    await waitFor(() => expect(snapshotGetCount).toBe(1)); // hello alone triggers no fetch

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
    "reconnects with backoff after a clean stream close, and immediately re-invalidates the snapshot on successful reconnect",
    async () => {
      const { Wrapper } = makeWrapper();
      const { getByTestId } = render(<Harness eventId="evt-1" />, { wrapper: Wrapper });

      await waitFor(() => expect(snapshotGetCount).toBe(1));
      await waitFor(() => expect(connections.length).toBe(1));
      connections[0].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("live"));

      connections[0].close();

      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("reconnecting"));

      // Backoff is 1s base +/-25% jitter (max 1250ms) -- bounded wait for
      // the retried connect() to land as a brand-new request.
      await waitFor(() => expect(connections.length).toBe(2), { timeout: 3000 });

      // The resync guarantee: invalidation fires as soon as the reconnect's
      // fetch resolves OK, BEFORE that connection's own hello frame arrives.
      await waitFor(() => expect(snapshotGetCount).toBe(2), { timeout: 1000 });

      connections[1].push("event: hello\ndata: {}\n\n");
      await waitFor(() => expect(getByTestId("status")).toHaveTextContent("live"));
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
