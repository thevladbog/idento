import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import * as agentLib from "../../lib/agent";
import { createWrapper } from "../../test/queryWrapper";
import type { Attendee } from "./types";
import { useCheckinFlow } from "./useCheckinFlow";

const attendee: Attendee = {
  id: "a1",
  event_id: "evt-1",
  first_name: "Alice",
  last_name: "Doe",
  email: "alice@example.com",
  company: "Acme",
  position: "Staff",
  code: "EVT-1",
  checkin_status: false,
  checked_in_at: null,
  printed_count: 0,
  blocked: false,
  block_reason: null,
};

const baseSettings = { print_on_checkin: true, verdict_auto_dismiss_sec: 4, scan_input: "wedge" as const, manual_search_enabled: true };

function setup(settingsOverride: Partial<typeof baseSettings> = {}) {
  return renderHook(
    () => useCheckinFlow({ eventId: "evt-1", stationId: "s1", settings: { ...baseSettings, ...settingsOverride }, printerName: "Zebra_Gate" }),
    { wrapper: createWrapper() },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useCheckinFlow.submitCode", () => {
  it("resolves not_registered client-side when the code lookup is empty", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [] });
    const { result } = setup();
    await act(() => result.current.submitCode("NOPE"));
    expect(result.current.state.status).toBe("verdict");
    expect(result.current.state.verdict).toBe("not_registered");
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1/attendees", { params: { code: "NOPE" } });
  });

  it("checks in a found attendee and auto-prints on checked_in", async () => {
    vi.spyOn(api, "get").mockImplementation((url: string) => {
      if (url.includes("/attendees")) return Promise.resolve({ data: [attendee] });
      return Promise.reject(new Error("unexpected GET " + url));
    });
    vi.spyOn(api, "post").mockImplementation((url: string) => {
      if (url.endsWith("/checkin")) return Promise.resolve({ data: { outcome: "checked_in", attendee, checkin: { at: "t", by_email: "x", point_name: null } } });
      if (url.endsWith("/badge-zpl")) return Promise.resolve({ data: { zpl: "^XA^XZ" } });
      if (url.endsWith("/printed")) return Promise.resolve({ data: { printed_count: 1 } });
      return Promise.reject(new Error("unexpected POST " + url));
    });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup();
    await act(() => result.current.submitCode("EVT-1"));

    expect(result.current.state.verdict).toBe("allowed");
    expect(agentPostSpy).toHaveBeenCalledWith("/print", JSON.stringify({ printer_name: "Zebra_Gate", zpl: "^XA^XZ" }));
    expect(api.post).toHaveBeenCalledWith("/api/attendees/a1/printed", undefined); // auto-print: no reprint audit
  });

  it("does not auto-print when print_on_checkin is false", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "checked_in", attendee, checkin: null } });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup({ print_on_checkin: false });
    await act(() => result.current.submitCode("EVT-1"));

    expect(result.current.state.verdict).toBe("allowed");
    expect(agentPostSpy).not.toHaveBeenCalled();
  });

  it("never auto-prints on already_checked_in, and never auto-dismisses it", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "already_checked_in", attendee, checkin: { at: "t", by_email: "x", point_name: null } } });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup();
    await act(() => result.current.submitCode("EVT-1"));

    expect(result.current.state.verdict).toBe("already_checked_in");
    expect(agentPostSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.state.status).toBe("verdict"); // still waiting for the operator
  });

  it("auto-dismisses an allowed verdict after verdict_auto_dismiss_sec", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "checked_in", attendee, checkin: null } });
    vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup({ print_on_checkin: false, verdict_auto_dismiss_sec: 4 });
    await act(() => result.current.submitCode("EVT-1"));
    expect(result.current.state.status).toBe("verdict");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(result.current.state.status).toBe("idle");
  });

  it("ignores a second submitCode while one is already resolving (re-entrancy guard)", async () => {
    let resolveGet: (value: { data: Attendee[] }) => void = () => {};
    vi.spyOn(api, "get").mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

    const { result } = setup();
    const first = act(() => result.current.submitCode("EVT-1"));
    await act(() => result.current.submitCode("EVT-1")); // dropped, busyRef is set

    expect(api.get).toHaveBeenCalledTimes(1);
    resolveGet({ data: [] });
    await first;
  });

  it("resets to idle and records requestError on a network failure", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("network down"));
    const { result } = setup();
    await act(async () => {
      await result.current.submitCode("EVT-1").catch(() => {});
    });
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.requestError).toBeInstanceOf(Error);
  });
});

describe("useCheckinFlow.printCurrent", () => {
  it("no-ops when the current verdict is not allowed", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    vi.spyOn(api, "post").mockResolvedValue({ data: { outcome: "blocked", attendee, checkin: null } });
    const agentPostSpy = vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup();
    await act(() => result.current.submitCode("EVT-1"));
    expect(result.current.state.verdict).toBe("no_access");

    agentPostSpy.mockClear();
    await act(() => result.current.printCurrent());
    expect(agentPostSpy).not.toHaveBeenCalled();
  });

  it("prints with a reprint audit (event_id + station_id) when the operator taps Печать", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [attendee] });
    const postSpy = vi.spyOn(api, "post").mockImplementation((url: string) => {
      if (url.endsWith("/checkin")) return Promise.resolve({ data: { outcome: "checked_in", attendee, checkin: null } });
      if (url.endsWith("/badge-zpl")) return Promise.resolve({ data: { zpl: "^XA^XZ" } });
      if (url.endsWith("/printed")) return Promise.resolve({ data: { printed_count: 2 } });
      return Promise.reject(new Error("unexpected POST " + url));
    });
    vi.spyOn(agentLib, "agentPost").mockResolvedValue("{}");

    const { result } = setup({ print_on_checkin: false }); // no auto-print, so the button is the only print path
    await act(() => result.current.submitCode("EVT-1"));
    postSpy.mockClear();

    await act(() => result.current.printCurrent());
    expect(postSpy).toHaveBeenCalledWith("/api/attendees/a1/printed", { event_id: "evt-1", station_id: "s1" });
  });
});
