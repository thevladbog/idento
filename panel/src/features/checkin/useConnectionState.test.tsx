// P4.1 Task 10 -- useConnectionState tests. Real timers throughout EXCEPT
// the one PR #77 Finding J test at the bottom (the hook's DEBOUNCE_MS is
// small enough that `waitFor`'s default polling comfortably observes it
// settle with real timers, but proving the 20s health poll itself would make
// that one test unbearably slow for real -- see that test's own comment).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { CHECKIN_ACTIONS_KEY } from "./hooks";
import { useConnectionState } from "./useConnectionState";

// Mirrors useConnectionState.ts's own (unexported) DEBOUNCE_MS -- kept as a
// literal here rather than imported, same "no shared test-only export just
// for a magic number" precedent as useHeartbeat.test.tsx's own inline 20s.
const DEBOUNCE_MS_FOR_TEST = 400;

let actionsShouldError = false;
let actionsHitCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/checkin-actions", () => {
    actionsHitCount += 1;
    if (actionsShouldError) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json({ actions: [] });
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

describe("useConnectionState", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    actionsShouldError = false;
    actionsHitCount = 0;
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("starts online when the browser reports online and the actions feed loads fine", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(actionsHitCount).toBeGreaterThan(0));
    expect(result.current.online).toBe(true);
  });

  it("goes offline (debounced) when the browser fires the 'offline' event, and back online on 'online'", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.online).toBe(true));

    Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });
    window.dispatchEvent(new Event("offline"));

    await waitFor(() => expect(result.current.online).toBe(false), { timeout: 2000 });

    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(result.current.online).toBe(true), { timeout: 2000 });
  });

  it("goes offline when the check-in actions feed keeps erroring, even though the browser reports online", async () => {
    actionsShouldError = true;
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.online).toBe(false), { timeout: 2000 });
  });

  it("recovers once the underlying actions query itself recovers (e.g. a refetch triggered elsewhere succeeds)", async () => {
    actionsShouldError = true;
    const { qc, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.online).toBe(false), { timeout: 2000 });

    actionsShouldError = false;
    await qc.refetchQueries({ queryKey: CHECKIN_ACTIONS_KEY("evt-1") });

    await waitFor(() => expect(result.current.online).toBe(true), { timeout: 2000 });
  });

  // PR #77 bot-review round, Finding J -- without a recurring poll, `online`
  // only reacts to the INITIAL fetch plus navigator.onLine events, so a
  // backend that goes down mid-shift while the browser still reports itself
  // online would never flip the signal unless some UNRELATED refetch (a
  // window focus, another operator's mutation) happened to occur. Fake
  // timers here (unlike every OTHER test in this file, which deliberately
  // uses real ones) -- same deviation, and the same reasoning, as
  // useHeartbeat.test.tsx's own real-20s-interval problem: waiting out a
  // real 20s poll would make this suite unbearably slow, and
  // `vi.advanceTimersByTimeAsync` (never the sync variant) flushes the
  // pending MSW-intercepted refetch between simulated ticks.
  it("transitions from online to degraded after the periodic health poll detects the backend going down mid-shift, with no unrelated trigger", async () => {
    vi.useFakeTimers();
    try {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: Wrapper });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS_FOR_TEST);
      expect(result.current.online).toBe(true);
      expect(actionsHitCount).toBe(1);

      // The backend goes down mid-shift -- navigator.onLine never changes,
      // and nothing else triggers a refetch.
      actionsShouldError = true;

      // Crosses the 20s poll boundary, then the debounce window. One more
      // zero-ms advance flushes react-query's own notifyManager batching
      // (a macrotask, not a microtask -- the query's internal state DOES
      // flip to "error" within the advances above, but React doesn't
      // re-render `result.current` from it until this next tick).
      await vi.advanceTimersByTimeAsync(20_000 + DEBOUNCE_MS_FOR_TEST);
      await vi.advanceTimersByTimeAsync(0);

      expect(actionsHitCount).toBe(2);
      expect(result.current.online).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
