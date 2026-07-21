import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { createWrapper } from "../../test/queryWrapper";
import { useConnectionState } from "./useConnectionState";

describe("useConnectionState", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    vi.restoreAllMocks();
  });

  it("reports online when the browser is online and the feed query succeeds", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { actions: [] } });
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.online).toBe(true), { timeout: 2000 });
  });

  it("reports offline (after the debounce) when the browser fires offline", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { actions: [] } });
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.online).toBe(true), { timeout: 2000 });

    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await waitFor(() => expect(result.current.online).toBe(false), { timeout: 2000 });

    // TanStack Query's onlineManager singleton (@tanstack/query-core) listens
    // for native window online/offline events independently of any
    // per-test QueryClient. Without this compensating "online" dispatch, it
    // stays stuck offline for the rest of the file and (since queries default
    // to networkMode: "online") silently pauses every later test's queries.
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });

  it("reports offline when the feed query errors, even though navigator.onLine is true", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useConnectionState("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.online).toBe(false), { timeout: 2000 });
    expect(navigator.onLine).toBe(true);
  });
});
