// P4.1 Task 12 -- useHeartbeat tests.
//
// Fake timers (unlike this feature's other timer-based hooks --
// useCheckinFlow.test.tsx's auto-dismiss test and useConnectionState.test.tsx
// both deliberately use REAL, short timers instead, citing "no fake-timer
// precedent exists anywhere in this repo" and a risk of a fake-clock/MSW
// interceptor interaction bug). This hook's own interval is a real 20s per
// the brief, though -- waiting that out with real timers would make this
// suite unbearably slow (and brittle under CI scheduling jitter), so this is
// the one hook in the feature where the fake clock is worth the risk.
// `vi.advanceTimersByTimeAsync` (never the sync `advanceTimersByTime`) is
// used throughout specifically because it flushes pending microtasks/promises
// between simulated ticks, which is what lets a REAL MSW-intercepted fetch
// (fired synchronously inside the interval callback via TanStack Query's
// `mutate()`) actually resolve while the fake clock advances.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { useHeartbeat } from "./useHeartbeat";

let heartbeatHitCount = 0;
let heartbeatShouldError = false;
let lastParams: { eventId?: string; stationId?: string } = {};

const server = startMswServer(
  http.post("http://api.test/api/events/:eventId/checkin-stations/:id/heartbeat", ({ params }) => {
    heartbeatHitCount += 1;
    lastParams = { eventId: String(params.eventId), stationId: String(params.id) };
    if (heartbeatShouldError) return new HttpResponse(null, { status: 500 });
    return new HttpResponse(null, { status: 204 });
  }),
);
void server;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// A minimal harness -- useHeartbeat has no return value (it is mounted
// purely for its side effect, per the brief: "Mounted by StationPage"), so
// the only observable surface is the network traffic it causes plus the
// fact that the harness itself keeps rendering normally (proof that a
// failed heartbeat doesn't throw/unmount its owner).
function Harness({ eventId, stationId }: { eventId: string; stationId: string | null }) {
  useHeartbeat(eventId, stationId);
  return <div data-testid="harness">alive</div>;
}

describe("useHeartbeat", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    heartbeatHitCount = 0;
    heartbeatShouldError = false;
    lastParams = {};
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts an immediate heartbeat on mount", async () => {
    const Wrapper = makeWrapper();
    render(<Harness eventId="evt-1" stationId="st-1" />, { wrapper: Wrapper });

    await vi.advanceTimersByTimeAsync(0);

    expect(heartbeatHitCount).toBe(1);
    expect(lastParams).toEqual({ eventId: "evt-1", stationId: "st-1" });
  });

  it("posts a second heartbeat after 20s, and not a moment before", async () => {
    const Wrapper = makeWrapper();
    render(<Harness eventId="evt-1" stationId="st-1" />, { wrapper: Wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeatHitCount).toBe(1);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(heartbeatHitCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeatHitCount).toBe(2);
  });

  it("clears the interval on unmount -- no further heartbeat after unmounting", async () => {
    const Wrapper = makeWrapper();
    const { unmount } = render(<Harness eventId="evt-1" stationId="st-1" />, { wrapper: Wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeatHitCount).toBe(1);

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatHitCount).toBe(1);
  });

  it("a failed heartbeat is non-fatal -- it neither throws nor unmounts its owner, and the next tick still retries", async () => {
    heartbeatShouldError = true;
    const Wrapper = makeWrapper();
    const { getByTestId } = render(<Harness eventId="evt-1" stationId="st-1" />, { wrapper: Wrapper });

    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeatHitCount).toBe(1);
    expect(getByTestId("harness")).toHaveTextContent("alive");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(heartbeatHitCount).toBe(2);
    expect(getByTestId("harness")).toHaveTextContent("alive");
  });

  it("does nothing when stationId is null -- no immediate POST, no interval", async () => {
    const Wrapper = makeWrapper();
    render(<Harness eventId="evt-1" stationId={null} />, { wrapper: Wrapper });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatHitCount).toBe(0);
  });
});
