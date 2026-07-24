import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { useAttendeeDetail, useAttendeesPage } from "../attendees/hooks";
import {
  CHECKIN_ACTIONS_KEY,
  CHECKIN_SETTINGS_KEY,
  CHECKIN_STATIONS_KEY,
  useCheckinActions,
  useCheckinSettings,
  useCheckinStations,
  useRegisterStation,
  useSaveCheckinSettings,
  useStationCheckin,
  useStationHeartbeat,
  useUndoCheckin,
} from "./hooks";

interface CapturedRequest {
  path: string;
  method: string;
  params: URLSearchParams;
  body?: unknown;
}

let captured: CapturedRequest[] = [];
let settingsGetCount = 0;
let stationsGetCount = 0;
let heartbeatPostCount = 0;
let actionsGetCount = 0;
let attendeesGetCount = 0;
let attendeeDetailGetCount = 0;

let currentSettings: unknown = null;

function makeAttendee(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    event_id: "evt-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    position: "Engineer",
    code: "CODE1",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const server = startMswServer(
  http.get("http://api.test/api/events/:id/checkin-settings", ({ request }) => {
    settingsGetCount += 1;
    const url = new URL(request.url);
    captured.push({ path: "getCheckinSettings", method: "GET", params: url.searchParams });
    return HttpResponse.json({ settings: currentSettings });
  }),
  http.put("http://api.test/api/events/:id/checkin-settings", async ({ request }) => {
    const body = (await request.json()) as { settings: unknown };
    currentSettings = body.settings;
    captured.push({ path: "putCheckinSettings", method: "PUT", params: new URLSearchParams(), body });
    return HttpResponse.json({ settings: currentSettings });
  }),
  http.get("http://api.test/api/events/:eventId/checkin-stations", ({ request }) => {
    stationsGetCount += 1;
    const url = new URL(request.url);
    captured.push({ path: "listCheckinStations", method: "GET", params: url.searchParams });
    return HttpResponse.json({
      stations: [
        {
          id: "st-1",
          event_id: "evt-1",
          name: "Main Door",
          last_seen_at: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
  }),
  http.post("http://api.test/api/events/:eventId/checkin-stations", async ({ request }) => {
    const body = (await request.json()) as { name: string; zone_id?: string | null };
    captured.push({ path: "registerCheckinStation", method: "POST", params: new URLSearchParams(), body });
    return HttpResponse.json({
      station: {
        id: "st-1",
        event_id: "evt-1",
        name: body.name,
        zone_id: body.zone_id ?? null,
        last_seen_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    });
  }),
  http.post("http://api.test/api/events/:eventId/checkin-stations/:id/heartbeat", ({ params }) => {
    heartbeatPostCount += 1;
    captured.push({
      path: "heartbeatCheckinStation",
      method: "POST",
      params: new URLSearchParams({ eventId: String(params.eventId), id: String(params.id) }),
    });
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("http://api.test/api/events/:eventId/checkin-actions", ({ request }) => {
    actionsGetCount += 1;
    const url = new URL(request.url);
    captured.push({ path: "getCheckinActions", method: "GET", params: url.searchParams });
    return HttpResponse.json({
      actions: [
        {
          id: "ca-1",
          action: "checkin",
          station_id: "st-1",
          created_at: "2026-01-01T00:00:00Z",
          attendee: { id: "att-1", first_name: "Ada", last_name: "Lovelace", code: "CODE1" },
        },
      ],
    });
  }),
  http.post("http://api.test/api/events/:eventId/checkin", async ({ request }) => {
    const body = (await request.json()) as { attendee_id: string; station_id?: string | null };
    captured.push({ path: "stationCheckin", method: "POST", params: new URLSearchParams(), body });
    return HttpResponse.json({
      outcome: "checked_in",
      attendee: makeAttendee({ id: body.attendee_id, checkin_status: true }),
      checkin: { at: "2026-01-01T00:00:00Z", by_email: "staff@example.com", point_name: "Main Door" },
    });
  }),
  http.post("http://api.test/api/events/:eventId/checkin/undo", async ({ request }) => {
    const body = (await request.json()) as { attendee_id: string; station_id?: string | null };
    captured.push({ path: "undoCheckin", method: "POST", params: new URLSearchParams(), body });
    return HttpResponse.json({ attendee: makeAttendee({ id: body.attendee_id, checkin_status: false }) });
  }),
  http.get("http://api.test/api/attendees/:id", ({ params }) => {
    attendeeDetailGetCount += 1;
    captured.push({ path: "getAttendeeDetail", method: "GET", params: new URLSearchParams({ id: String(params.id) }) });
    return HttpResponse.json(makeAttendee({ id: params.id, checkin_status: true }));
  }),
  http.get("http://api.test/api/events/:eventId/attendees", ({ request }) => {
    attendeesGetCount += 1;
    const url = new URL(request.url);
    captured.push({ path: "getAttendees", method: "GET", params: url.searchParams });
    return HttpResponse.json({
      attendees: [makeAttendee()],
      total: 1,
      page: Number(url.searchParams.get("page") ?? "1"),
      per_page: Number(url.searchParams.get("per_page") ?? "50"),
    });
  }),
);
void server;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

describe("checkin hooks", () => {
  beforeEach(() => {
    captured = [];
    settingsGetCount = 0;
    stationsGetCount = 0;
    heartbeatPostCount = 0;
    actionsGetCount = 0;
    attendeesGetCount = 0;
    attendeeDetailGetCount = 0;
    currentSettings = null;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  describe("useCheckinSettings", () => {
    it("GETs /api/events/{id}/checkin-settings and parses null settings into defaults", async () => {
      const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(settingsGetCount).toBe(1);
      expect(result.current.data).toEqual({
        print_on_checkin: true,
        verdict_auto_dismiss_sec: 4,
        scan_input: "wedge",
        manual_search_enabled: true,
      });
    });

    it("parses a partial stored settings object through parseCheckinSettings' select", async () => {
      currentSettings = { scan_input: "scanner" };
      const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.scan_input).toBe("scanner");
      expect(result.current.data?.print_on_checkin).toBe(true);
    });
  });

  describe("useSaveCheckinSettings", () => {
    it("PUTs the settings body and invalidates CHECKIN_SETTINGS_KEY so the read query refetches", async () => {
      const { Wrapper } = makeWrapper();
      const { result: readResult } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: Wrapper });
      await waitFor(() => expect(readResult.current.isSuccess).toBe(true));
      expect(settingsGetCount).toBe(1);

      const { result: saveResult } = renderHook(() => useSaveCheckinSettings("evt-1"), { wrapper: Wrapper });
      saveResult.current.mutate({
        params: { path: { id: "evt-1" } },
        body: {
          settings: {
            print_on_checkin: false,
            verdict_auto_dismiss_sec: 8,
            scan_input: "manual",
            manual_search_enabled: false,
          },
        },
      });
      await waitFor(() => expect(saveResult.current.isSuccess).toBe(true));

      const putCall = captured.find((c) => c.path === "putCheckinSettings");
      expect((putCall?.body as { settings: unknown })?.settings).toEqual({
        print_on_checkin: false,
        verdict_auto_dismiss_sec: 8,
        scan_input: "manual",
        manual_search_enabled: false,
      });

      await waitFor(() => expect(settingsGetCount).toBe(2));
    });

    it("seeds a mounted useCheckinSettings observer with the just-saved values immediately on success — not DEFAULT_CHECKIN_SETTINGS", async () => {
      // Regression test: onSuccess must seed the cache with the raw {settings}
      // envelope (matching what GET/PUT actually return), not the
      // already-`select`-ed CheckinSettings object. If it re-shapes the
      // response before calling setQueryData, useCheckinSettings' own
      // `select: (data) => parseCheckinSettings(data.settings)` re-runs
      // against that wrongly-shaped raw value immediately, `data.settings` is
      // `undefined`, and parseCheckinSettings(undefined) falls back to
      // DEFAULT_CHECKIN_SETTINGS — a visible flash of hard-coded defaults
      // right after the operator saved something else, self-correcting only
      // once the invalidateQueries refetch resolves.
      //
      // To observe that in-between moment deterministically, this test
      // overrides the GET handler so the SECOND request (the refetch that
      // invalidateQueries kicks off) resolves after a delay — long enough
      // that we can assert on the read hook's data while that refetch is
      // still in flight, un-masked by its result. Without the delay, MSW's
      // near-instant mock response lets the refetch complete before this
      // assertion runs, which would hide the bug (the correct refetched data
      // would overwrite whatever setQueryData wrote first).
      //
      // Also note: the render callback below explicitly destructures `data`
      // (rather than returning the whole query result object untouched).
      // TanStack Query's tracked-properties optimization only re-renders
      // observers for fields actually read during a render; if `data` is
      // never read there, the observer won't re-render on a data-only
      // update and `result.current` would look permanently frozen at its
      // first successful value — regardless of whether this bug is fixed.
      let refetchGetCount = 0;
      server.use(
        http.get("http://api.test/api/events/:id/checkin-settings", async () => {
          refetchGetCount += 1;
          settingsGetCount += 1;
          if (refetchGetCount > 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return HttpResponse.json({ settings: currentSettings });
        }),
      );

      const { Wrapper } = makeWrapper();
      const { result: readResult } = renderHook(
        () => {
          const query = useCheckinSettings("evt-1");
          return { isSuccess: query.isSuccess, data: query.data };
        },
        { wrapper: Wrapper },
      );
      await waitFor(() => expect(readResult.current.isSuccess).toBe(true));
      expect(settingsGetCount).toBe(1);

      const { result: saveResult } = renderHook(() => useSaveCheckinSettings("evt-1"), { wrapper: Wrapper });
      saveResult.current.mutate({
        params: { path: { id: "evt-1" } },
        body: {
          settings: {
            print_on_checkin: false,
            verdict_auto_dismiss_sec: 8,
            scan_input: "manual",
            manual_search_enabled: false,
          },
        },
      });
      await waitFor(() => expect(saveResult.current.isSuccess).toBe(true));

      // The refetch has been kicked off (refetchGetCount is already 2) but is
      // still artificially delayed — it has NOT resolved yet, so this
      // assertion is exercising only the synchronous setQueryData seed.
      expect(refetchGetCount).toBe(2);
      expect(readResult.current.data).toEqual({
        print_on_checkin: false,
        verdict_auto_dismiss_sec: 8,
        scan_input: "manual",
        manual_search_enabled: false,
      });
    });
  });

  describe("CHECKIN_SETTINGS_KEY", () => {
    it("matches useCheckinSettings' exact query for the given event", async () => {
      const { qc, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(settingsGetCount).toBe(1);

      await qc.invalidateQueries({ queryKey: CHECKIN_SETTINGS_KEY("evt-1") });

      await waitFor(() => expect(settingsGetCount).toBe(2));
    });

    it("does not match a different event's settings query", async () => {
      const { qc, Wrapper } = makeWrapper();
      const { result: evt1 } = renderHook(() => useCheckinSettings("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useCheckinSettings("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(settingsGetCount).toBe(2);

      await qc.invalidateQueries({ queryKey: CHECKIN_SETTINGS_KEY("evt-1") });

      await waitFor(() => expect(settingsGetCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settingsGetCount).toBe(3);
    });
  });

  describe("useCheckinStations / useRegisterStation", () => {
    it("useCheckinStations GETs the event's station list", async () => {
      const { result } = renderHook(() => useCheckinStations("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(stationsGetCount).toBe(1);
      expect(result.current.data?.stations).toHaveLength(1);
      expect(result.current.data?.stations[0]?.name).toBe("Main Door");
    });

    it("useRegisterStation POSTs {name, zone_id} and invalidates CHECKIN_STATIONS_KEY", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useCheckinStations("evt-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(stationsGetCount).toBe(1);

      const { result: registerResult } = renderHook(() => useRegisterStation("evt-1"), { wrapper: Wrapper });
      registerResult.current.mutate({
        params: { path: { event_id: "evt-1" } },
        body: { name: "North Door", zone_id: "zone-1" },
      });
      await waitFor(() => expect(registerResult.current.isSuccess).toBe(true));

      const registerCall = captured.find((c) => c.path === "registerCheckinStation");
      expect(registerCall?.body).toEqual({ name: "North Door", zone_id: "zone-1" });

      await waitFor(() => expect(stationsGetCount).toBe(2));
    });

    describe("CHECKIN_STATIONS_KEY", () => {
      it("does not match a different event's stations query", async () => {
        const { qc, Wrapper } = makeWrapper();
        const { result: evt1 } = renderHook(() => useCheckinStations("evt-1"), { wrapper: Wrapper });
        const { result: evt2 } = renderHook(() => useCheckinStations("evt-2"), { wrapper: Wrapper });
        await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
        await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
        expect(stationsGetCount).toBe(2);

        await qc.invalidateQueries({ queryKey: CHECKIN_STATIONS_KEY("evt-1") });

        await waitFor(() => expect(stationsGetCount).toBe(3));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stationsGetCount).toBe(3);
      });
    });
  });

  describe("useStationHeartbeat", () => {
    it("POSTs the heartbeat for the given station id with no body", async () => {
      const { result } = renderHook(() => useStationHeartbeat("evt-1"), { wrapper });
      result.current.mutate({ params: { path: { event_id: "evt-1", id: "st-1" } } });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(heartbeatPostCount).toBe(1);
    });

    it("invalidates CHECKIN_STATIONS_KEY on success, so a mounted station list refetches", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useCheckinStations("evt-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(stationsGetCount).toBe(1);

      const { result: heartbeatResult } = renderHook(() => useStationHeartbeat("evt-1"), { wrapper: Wrapper });
      heartbeatResult.current.mutate({ params: { path: { event_id: "evt-1", id: "st-1" } } });
      await waitFor(() => expect(heartbeatResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(stationsGetCount).toBe(2));
    });
  });

  describe("useCheckinActions", () => {
    it("GETs the actions feed, defaulting limit to 50", async () => {
      const { result } = renderHook(() => useCheckinActions("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(actionsGetCount).toBe(1);
      const call = captured.find((c) => c.path === "getCheckinActions");
      expect(call?.params.get("limit")).toBe("50");
      expect(result.current.data?.actions).toHaveLength(1);
      expect(result.current.data?.actions[0]?.attendee.first_name).toBe("Ada");
    });

    it("sends a custom limit when given", async () => {
      const { result } = renderHook(() => useCheckinActions("evt-1", 10), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const call = captured.find((c) => c.path === "getCheckinActions");
      expect(call?.params.get("limit")).toBe("10");
    });

    describe("CHECKIN_ACTIONS_KEY", () => {
      it("prefix-matches regardless of limit, scoped to one event (invalidateQueries refetches it)", async () => {
        const { qc, Wrapper } = makeWrapper();
        const { result: default50 } = renderHook(() => useCheckinActions("evt-1"), { wrapper: Wrapper });
        const { result: limited10 } = renderHook(() => useCheckinActions("evt-1", 10), { wrapper: Wrapper });
        await waitFor(() => expect(default50.current.isSuccess).toBe(true));
        await waitFor(() => expect(limited10.current.isSuccess).toBe(true));
        expect(actionsGetCount).toBe(2);

        await qc.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY("evt-1") });

        await waitFor(() => expect(actionsGetCount).toBe(4));
      });

      it("does not match a different event's actions query", async () => {
        const { qc, Wrapper } = makeWrapper();
        const { result: evt1 } = renderHook(() => useCheckinActions("evt-1"), { wrapper: Wrapper });
        const { result: evt2 } = renderHook(() => useCheckinActions("evt-2"), { wrapper: Wrapper });
        await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
        await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
        expect(actionsGetCount).toBe(2);

        await qc.invalidateQueries({ queryKey: CHECKIN_ACTIONS_KEY("evt-1") });

        await waitFor(() => expect(actionsGetCount).toBe(3));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(actionsGetCount).toBe(3);
      });
    });
  });

  describe("useStationCheckin / useUndoCheckin — actions key prefix-invalidation", () => {
    it("useStationCheckin invalidates CHECKIN_ACTIONS_KEY and ATTENDEES_LIST_KEY on success", async () => {
      const { Wrapper } = makeWrapper();
      const { result: actionsResult } = renderHook(() => useCheckinActions("evt-1"), { wrapper: Wrapper });
      const { result: attendeesResult } = renderHook(
        () => useAttendeesPage("evt-1", { page: 1 }),
        { wrapper: Wrapper },
      );
      await waitFor(() => expect(actionsResult.current.isSuccess).toBe(true));
      await waitFor(() => expect(attendeesResult.current.isSuccess).toBe(true));
      expect(actionsGetCount).toBe(1);
      expect(attendeesGetCount).toBe(1);

      const { result: checkinResult } = renderHook(() => useStationCheckin("evt-1"), { wrapper: Wrapper });
      checkinResult.current.mutate({
        params: { path: { event_id: "evt-1" } },
        body: { attendee_id: "att-1", station_id: "st-1" },
      });
      await waitFor(() => expect(checkinResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(actionsGetCount).toBe(2));
      await waitFor(() => expect(attendeesGetCount).toBe(2));
    });

    it("useUndoCheckin invalidates CHECKIN_ACTIONS_KEY and ATTENDEES_LIST_KEY on success", async () => {
      const { Wrapper } = makeWrapper();
      const { result: actionsResult } = renderHook(() => useCheckinActions("evt-1"), { wrapper: Wrapper });
      const { result: attendeesResult } = renderHook(
        () => useAttendeesPage("evt-1", { page: 1 }),
        { wrapper: Wrapper },
      );
      await waitFor(() => expect(actionsResult.current.isSuccess).toBe(true));
      await waitFor(() => expect(attendeesResult.current.isSuccess).toBe(true));
      expect(actionsGetCount).toBe(1);
      expect(attendeesGetCount).toBe(1);

      const { result: undoResult } = renderHook(() => useUndoCheckin("evt-1"), { wrapper: Wrapper });
      undoResult.current.mutate({
        params: { path: { event_id: "evt-1" } },
        body: { attendee_id: "att-1", station_id: "st-1" },
      });
      await waitFor(() => expect(undoResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(actionsGetCount).toBe(2));
      await waitFor(() => expect(attendeesGetCount).toBe(2));
    });

    it("does not invalidate a different event's actions feed", async () => {
      const { Wrapper } = makeWrapper();
      const { result: evt2Actions } = renderHook(() => useCheckinActions("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt2Actions.current.isSuccess).toBe(true));
      expect(actionsGetCount).toBe(1);

      const { result: checkinResult } = renderHook(() => useStationCheckin("evt-1"), { wrapper: Wrapper });
      checkinResult.current.mutate({
        params: { path: { event_id: "evt-1" } },
        body: { attendee_id: "att-1" },
      });
      await waitFor(() => expect(checkinResult.current.isSuccess).toBe(true));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(actionsGetCount).toBe(1);
    });

    // Regression: AttendeeCard (P6.3) keeps useAttendeeDetail mounted for the
    // whole time its QR/undo/block actions are visible. Before this fix,
    // neither hook invalidated ATTENDEE_DETAIL_KEY, so a mounted card kept
    // showing the pre-mutation checkin_status indefinitely even though the
    // attendees list (and thus the search results behind the card) had
    // already refetched and moved on — a real, reproducible staleness bug
    // caught during the P6.3 Task 11 live device walk.
    it("useStationCheckin invalidates ATTENDEE_DETAIL_KEY for the mutated attendee", async () => {
      const { Wrapper } = makeWrapper();
      const { result: detailResult } = renderHook(() => useAttendeeDetail("att-1"), { wrapper: Wrapper });
      await waitFor(() => expect(detailResult.current.isSuccess).toBe(true));
      expect(attendeeDetailGetCount).toBe(1);

      const { result: checkinResult } = renderHook(() => useStationCheckin("evt-1"), { wrapper: Wrapper });
      checkinResult.current.mutate({
        params: { path: { event_id: "evt-1" } },
        body: { attendee_id: "att-1", station_id: "st-1" },
      });
      await waitFor(() => expect(checkinResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(attendeeDetailGetCount).toBe(2));
    });

    it("useUndoCheckin invalidates ATTENDEE_DETAIL_KEY for the mutated attendee", async () => {
      const { Wrapper } = makeWrapper();
      const { result: detailResult } = renderHook(() => useAttendeeDetail("att-1"), { wrapper: Wrapper });
      await waitFor(() => expect(detailResult.current.isSuccess).toBe(true));
      expect(attendeeDetailGetCount).toBe(1);

      const { result: undoResult } = renderHook(() => useUndoCheckin("evt-1"), { wrapper: Wrapper });
      undoResult.current.mutate({
        params: { path: { event_id: "evt-1" } },
        body: { attendee_id: "att-1", station_id: "st-1" },
      });
      await waitFor(() => expect(undoResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(attendeeDetailGetCount).toBe(2));
    });
  });
});
