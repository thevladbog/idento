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
// side effects (registered via beforeAll/afterEach/afterAll) and for the
// machine_id-overwrite test below, which needs a per-test server.use()
// override -- same idiom as useAgentPrinters.test.tsx.

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

  // Task 5 fix round: `info` is documented "live only" -- that must also
  // hold when the CALLER disables the hook, not just when a probe fails.
  // Disabling a react-query query does NOT clear its status/data (the last
  // successful fetch's `data`/`isSuccess` survive), so `info` must be gated
  // on `enabled` the same way `state` already is.
  it("nulls info (matching the forced disconnected state) when the caller flips enabled to false after a successful probe", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAgentInfo(enabled), {
      wrapper,
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.info).toEqual(INFO);

    rerender({ enabled: false });
    expect(result.current.state).toBe("disconnected");
    expect(result.current.info).toBeNull();
    // cachedInfo is the deliberate survives-anything surface -- unaffected.
    expect(result.current.cachedInfo).toEqual(INFO);
  });

  // Task 5 fix round: the cache write lives inside the queryFn, so a
  // throwing localStorage.setItem (Safari private mode, quota exceeded)
  // must never reject the probe -- identity caching is a convenience and
  // must never take connectivity down with it.
  it("still reports connected with live info when the cache write throws (private mode / quota)", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useAgentInfo(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      expect(result.current.info).toEqual(INFO);
    } finally {
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  // Task 5 fix round: pins that the cache tracks the LATEST identity -- a
  // reconnect that reports a different machine_id (agent reinstalled, or
  // AGENT_URL now served by different hardware) overwrites the old entry
  // rather than keeping first-write-wins.
  it("overwrites the cached identity when a reconnect reports a different machine_id", async () => {
    const { result } = renderHook(() => useAgentInfo(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(readCachedAgentInfo()).toEqual(INFO);

    const REINSTALLED = { ...INFO, machine_id: "mach-def456", uptime_seconds: 5 };
    server.use(http.get("http://agent.test/info", () => HttpResponse.json(REINSTALLED)));
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.info).toEqual(REINSTALLED));
    expect(readCachedAgentInfo()).toEqual(REINSTALLED);
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
