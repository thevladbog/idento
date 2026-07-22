import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setManifestUrlOverride } from "../../lib/updateConfig";
import { createWrapper } from "../../test/queryWrapper";
import { useInstallUpdate, useUpdateCheck } from "./useUpdateCheck";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("useUpdateCheck", () => {
  afterEach(() => {
    invokeMock.mockClear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("checks with endpointOverride: null when no manifest override is configured", async () => {
    invokeMock.mockResolvedValue({ available: false, version: "", notes: null });
    const { result } = renderHook(() => useUpdateCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith("check_for_update", { endpointOverride: null });
    expect(result.current.data?.available).toBe(false);
  });

  it("checks with the configured endpointOverride when a manifest URL is set", async () => {
    setManifestUrlOverride("https://mirror.example.internal/latest.json");
    invokeMock.mockResolvedValue({ available: true, version: "1.4.0", notes: "Bug fixes" });
    const { result } = renderHook(() => useUpdateCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith("check_for_update", {
      endpointOverride: "https://mirror.example.internal/latest.json",
    });
    expect(result.current.data?.version).toBe("1.4.0");
  });

  it("re-checks against the new endpoint once the manifest override changes", async () => {
    invokeMock.mockResolvedValue({ available: false, version: "", notes: null });
    const { result, rerender } = renderHook(() => useUpdateCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith("check_for_update", { endpointOverride: null });

    setManifestUrlOverride("https://mirror.example.internal/latest.json");
    rerender();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenLastCalledWith("check_for_update", {
      endpointOverride: "https://mirror.example.internal/latest.json",
    });
  });
});

describe("useInstallUpdate", () => {
  afterEach(() => {
    invokeMock.mockClear();
    vi.restoreAllMocks();
  });

  it("invokes install_update", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useInstallUpdate(), { wrapper: createWrapper() });
    await result.current.mutateAsync();
    expect(invokeMock).toHaveBeenCalledWith("install_update");
  });
});
