import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCachedAgentInfo } from "./agentInfoCache";
import { startMswServer } from "../../test/msw";
import { useAgentInfo } from "./useAgentInfo";

const INFO = {
  machine_id: "mach-abc123",
  hostname: "kiosk-07",
  version: "1.4.0",
  uptime_seconds: 3600,
};

let healthOk = true;
let infoStatus: 200 | 404 = 200;
let requestCounts = { health: 0, info: 0 };

const server = startMswServer(
  http.get("http://agent.test/health", () => {
    requestCounts.health += 1;
    return healthOk ? new HttpResponse(null, { status: 200 }) : HttpResponse.error();
  }),
  http.get("http://agent.test/info", () => {
    requestCounts.info += 1;
    if (infoStatus === 404) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(INFO);
  }),
);
// startMswServer's return value matters for its listen/reset/close lifecycle
// side effects (registered via beforeAll/afterEach/afterAll) even though no
// test below calls server.use() directly -- same idiom as
// useAgentPrinters.test.tsx.
void server;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useAgentInfo", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    healthOk = true;
    infoStatus = 200;
    requestCounts = { health: 0, info: 0 };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is disconnected and fetches nothing while disabled", () => {
    const { result } = renderHook(() => useAgentInfo(false), { wrapper });
    expect(result.current.state).toBe("disconnected");
    expect(result.current.info).toBeNull();
    expect(requestCounts.health).toBe(0);
  });

  it("reports checking synchronously, then connected with info populated and the cache written", async () => {
    const { result } = renderHook(() => useAgentInfo(true), { wrapper });
    expect(result.current.state).toBe("checking");

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.info).toEqual(INFO);
    expect(readCachedAgentInfo()).toEqual(INFO);
  });

  it("reports connected_legacy with null info when the agent is healthy but /info 404s (pre-P4.3 agent), leaving the cache untouched", async () => {
    infoStatus = 404;
    const { result } = renderHook(() => useAgentInfo(true), { wrapper });

    await waitFor(() => expect(result.current.state).toBe("connected_legacy"));
    expect(result.current.info).toBeNull();
    expect(readCachedAgentInfo()).toBeNull();
  });

  it("reports disconnected when the agent is unreachable, but cachedInfo still returns a previously-written cache", async () => {
    const { result } = renderHook(() => useAgentInfo(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.cachedInfo).toEqual(INFO);

    healthOk = false;
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.state).toBe("disconnected"));
    expect(result.current.info).toBeNull();
    // Board 5d: saved identity must stay visible while the agent is down --
    // cachedInfo is a plain read of localStorage, unaffected by the query's
    // own error state.
    expect(result.current.cachedInfo).toEqual(INFO);
  });

  // Board 5d's mono caption "auto-retry in 8 s" -- while disconnected the
  // query must re-probe every 8s on its own, no user action required.
  it("auto-retries every 8s while disconnected", async () => {
    healthOk = false;
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentInfo(true), { wrapper });

    // Initial probe fires immediately (react-query's mount fetch) and fails
    // health, landing the query in its error state.
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.state).toBe("disconnected");
    expect(requestCounts.health).toBe(1);

    // Not yet 8s -- no second probe.
    await vi.advanceTimersByTimeAsync(7_999);
    expect(requestCounts.health).toBe(1);

    // 8s elapsed -- refetchInterval fires the second probe.
    await vi.advanceTimersByTimeAsync(1);
    expect(requestCounts.health).toBe(2);
  });
});
