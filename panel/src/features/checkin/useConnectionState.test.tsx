// P4.1 Task 10 -- useConnectionState tests. Real timers throughout (no
// fake-timer precedent anywhere in this repo -- see useCheckinFlow.test.tsx's
// own comment on its auto-dismiss test): the hook's DEBOUNCE_MS is small
// enough that `waitFor`'s default polling comfortably observes it settle.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { CHECKIN_ACTIONS_KEY } from "./hooks";
import { useConnectionState } from "./useConnectionState";

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
});
