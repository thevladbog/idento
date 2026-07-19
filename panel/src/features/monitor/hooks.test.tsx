import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { MONITOR_SNAPSHOT_KEY, useMonitorSnapshot } from "./hooks";

let monitorGetCount = 0;
let capturedEventId: string | undefined;

function snapshotBody() {
  return {
    totals: { checked_in: 3, total: 10, rate_per_min: 1.2, peak: null, est_done_at: null },
    zones: [],
    unattributed: 0,
    stations: [],
    recent: [],
  };
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/monitor", ({ params }) => {
    monitorGetCount += 1;
    capturedEventId = params.eventId as string;
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

describe("monitor hooks", () => {
  beforeEach(() => {
    monitorGetCount = 0;
    capturedEventId = undefined;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("useMonitorSnapshot requests the event's monitor snapshot by id", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMonitorSnapshot("evt-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedEventId).toBe("evt-1");
    expect(result.current.data?.totals.checked_in).toBe(3);
    expect(result.current.data?.totals.total).toBe(10);
  });

  // Mirrors READINESS_KEY's describe block (events/hooks.test.tsx): the key
  // must actually match useMonitorSnapshot's real registered query key so
  // invalidateQueries (driven by Task 6's SSE 'update' frames) refetches it.
  describe("MONITOR_SNAPSHOT_KEY", () => {
    it("matches useMonitorSnapshot's query for the same event, so invalidateQueries refetches it", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result } = renderHook(() => useMonitorSnapshot("evt-1"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(monitorGetCount).toBe(1);

      await qc.invalidateQueries({ queryKey: MONITOR_SNAPSHOT_KEY("evt-1") });

      await waitFor(() => expect(monitorGetCount).toBe(2));
    });

    it("does not match a different event's monitor query", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: evt1 } = renderHook(() => useMonitorSnapshot("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useMonitorSnapshot("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(monitorGetCount).toBe(2);

      await qc.invalidateQueries({ queryKey: MONITOR_SNAPSHOT_KEY("evt-1") });

      // Only evt-1's query should refetch; give evt-2 a beat to (not) refetch.
      await waitFor(() => expect(monitorGetCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(monitorGetCount).toBe(3);
    });
  });
});
