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
  });
});
