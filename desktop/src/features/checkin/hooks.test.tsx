import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import * as agentLib from "../../lib/agent";
import { createWrapper } from "../../test/queryWrapper";
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useAgentInfo,
  useAgentPort,
  useCheckinActions,
  useCheckinSettings,
  useCheckinStations,
  useEvent,
  useMarkAttendeePrinted,
  useRegisterStation,
  useSaveCheckinSettings,
  useStationCheckin,
  useStationHeartbeat,
} from "./hooks";

// @tauri-apps/api/core ships real ESM named exports; its module namespace
// object isn't configurable, so vi.spyOn can't patch it directly (unlike
// in-project source, which Vite transforms into a mutable object). Mock the
// whole module instead -- same pattern as useAgentSupervisor.test.tsx.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCheckinSettings", () => {
  it("parses the settings envelope", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { settings: { print_on_checkin: false, verdict_auto_dismiss_sec: 4, scan_input: "wedge", manual_search_enabled: true } } });
    const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.print_on_checkin).toBe(false);
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1/checkin-settings");
  });

  it("falls back to defaults when settings is null", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { settings: null } });
    const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.scan_input).toBe("wedge");
  });
});

describe("useSaveCheckinSettings", () => {
  it("PUTs the settings body", async () => {
    const settings = { print_on_checkin: true, verdict_auto_dismiss_sec: 10, scan_input: "manual" as const, manual_search_enabled: true };
    vi.spyOn(api, "put").mockResolvedValue({ data: { settings } });
    const { result } = renderHook(() => useSaveCheckinSettings("evt-1"), { wrapper: createWrapper() });
    await result.current.mutateAsync(settings);
    expect(api.put).toHaveBeenCalledWith("/api/events/evt-1/checkin-settings", { settings });
  });
});

describe("useCheckinStations / useRegisterStation", () => {
  it("lists stations", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { stations: [{ id: "s1", event_id: "evt-1", name: "Стойка 1", zone_id: null, last_seen_at: "t", created_at: "t" }] } });
    const { result } = renderHook(() => useCheckinStations("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("registers a station", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { station: { id: "s1", event_id: "evt-1", name: "Стойка 1", zone_id: null, last_seen_at: "t", created_at: "t" } } });
    const { result } = renderHook(() => useRegisterStation("evt-1"), { wrapper: createWrapper() });
    const station = await result.current.mutateAsync({ name: "Стойка 1" });
    expect(station.id).toBe("s1");
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin-stations", { name: "Стойка 1" });
  });
});

describe("useStationHeartbeat", () => {
  it("POSTs the heartbeat for a station id", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useStationHeartbeat("evt-1"), { wrapper: createWrapper() });
    await result.current.mutateAsync("s1");
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin-stations/s1/heartbeat");
  });
});

describe("useCheckinActions", () => {
  it("GETs the feed with a limit query param", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { actions: [] } });
    const { result } = renderHook(() => useCheckinActions("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1/checkin-actions", { params: { limit: 50 } });
  });
});

describe("useStationCheckin", () => {
  it("POSTs attendee_id + station_id and returns the outcome", async () => {
    const response = { outcome: "checked_in", attendee: { id: "a1" }, checkin: { at: "t", by_email: "x", point_name: null } };
    vi.spyOn(api, "post").mockResolvedValue({ data: response });
    const { result } = renderHook(() => useStationCheckin("evt-1"), { wrapper: createWrapper() });
    const data = await result.current.mutateAsync({ attendee_id: "a1", station_id: "s1" });
    expect(data.outcome).toBe("checked_in");
    expect(api.post).toHaveBeenCalledWith("/api/events/evt-1/checkin", { attendee_id: "a1", station_id: "s1" });
  });
});

describe("useMarkAttendeePrinted", () => {
  it("sends no body when eventId is omitted (back-compat counter-only path)", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { printed_count: 3 } });
    const { result } = renderHook(() => useMarkAttendeePrinted(), { wrapper: createWrapper() });
    await result.current.mutateAsync({ attendeeId: "a1" });
    expect(api.post).toHaveBeenCalledWith("/api/attendees/a1/printed", undefined);
  });

  it("sends event_id + station_id when present (reprint audit path)", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { printed_count: 4 } });
    const { result } = renderHook(() => useMarkAttendeePrinted(), { wrapper: createWrapper() });
    await result.current.mutateAsync({ attendeeId: "a1", eventId: "evt-1", stationId: "s1" });
    expect(api.post).toHaveBeenCalledWith("/api/attendees/a1/printed", { event_id: "evt-1", station_id: "s1" });
  });
});

describe("useAgentDefaultPrinter", () => {
  it("parses the agent's default-printer response", async () => {
    vi.spyOn(agentLib, "agentGet").mockResolvedValue(JSON.stringify({ default: "Zebra_Gate" }));
    const { result } = renderHook(() => useAgentDefaultPrinter(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("Zebra_Gate");
  });

  it("resolves null when the agent has no default printer", async () => {
    vi.spyOn(agentLib, "agentGet").mockResolvedValue(JSON.stringify({ default: null }));
    const { result } = renderHook(() => useAgentDefaultPrinter(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useAgentHealth", () => {
  it("resolves the agent's health check", async () => {
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(true);
    const { result } = renderHook(() => useAgentHealth(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });
});

describe("useEvent", () => {
  it("GETs the event by id", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { id: "evt-1", name: "Технопром-2026" } });
    const { result } = renderHook(() => useEvent("evt-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Технопром-2026");
    expect(api.get).toHaveBeenCalledWith("/api/events/evt-1");
  });
});

describe("useAgentInfo", () => {
  it("parses the agent's /info response", async () => {
    vi.spyOn(agentLib, "agentGet").mockResolvedValue(
      JSON.stringify({ machine_id: "m1", hostname: "kiosk-1", version: "1.4.0", uptime_seconds: 120 }),
    );
    const { result } = renderHook(() => useAgentInfo(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.version).toBe("1.4.0");
  });
});

describe("useAgentPort", () => {
  it("resolves the Tauri get_agent_port command's value", async () => {
    invokeMock.mockResolvedValue(12345);
    const { result } = renderHook(() => useAgentPort(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(12345);
  });
});
