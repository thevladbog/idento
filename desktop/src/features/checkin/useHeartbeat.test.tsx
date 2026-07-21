import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { createWrapper } from "../../test/queryWrapper";
import { useHeartbeat } from "./useHeartbeat";

describe("useHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("beats immediately on mount, then every 20s, for a registered station", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: undefined });
    renderHook(() => useHeartbeat("evt-1", "s1"), { wrapper: createWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin-stations/s1/heartbeat");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("does nothing when stationId is null", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: undefined });
    renderHook(() => useHeartbeat("evt-1", null), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.post).not.toHaveBeenCalled();
  });
});
