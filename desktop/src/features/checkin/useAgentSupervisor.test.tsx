import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as agentLib from "../../lib/agent";
import { setAgentMode } from "../../lib/agentConfig";
import { createWrapper } from "../../test/queryWrapper";
import { useAgentSupervisor } from "./useAgentSupervisor";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("useAgentSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing while the agent stays healthy", async () => {
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(true);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("restarts after 3 consecutive unhealthy polls, then again after the backoff elapses", async () => {
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(false);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });

    await vi.advanceTimersByTimeAsync(0); // poll #1: unhealthy (failureCount=1)
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); // poll #2 (failureCount=2)
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); // poll #3 (failureCount=3) -> first restart, 1s cooldown starts
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("restart_agent");

    // The backoff cooldown itself now drives the retry: once the initial 1s
    // cooldown elapses it force-refetches the health query directly, rather
    // than waiting for the next up-to-20s-away scheduled poll. Still
    // unhealthy -> restart #2, well under the 20s poll interval away from
    // restart #1 -- this is the assertion that proves backoff (not the poll
    // interval) now drives the cadence.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invokeMock).toHaveBeenCalledTimes(2);

    // Backoff has now doubled to 2s -- a restart #3 should follow ~2s after
    // restart #2, again well before the next 20s poll would fire.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("resets the failure count and backoff after a healthy poll", async () => {
    const healthSpy = vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(false);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0); // failureCount=1
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=2 (still under threshold)

    healthSpy.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000); // healthy -> full reset
    expect(invokeMock).not.toHaveBeenCalled();

    healthSpy.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=1 again (fresh run needed)
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=2
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=3 -> restart
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing in external mode", async () => {
    setAgentMode("external");
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(false);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
