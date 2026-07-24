import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import {
  ATTENDEE_DETAIL_KEY,
  ATTENDEES_LIST_KEY,
  useAttendeesPage,
  useBlockAttendee,
  useEventZones,
  useUnblockAttendee,
} from "./hooks";

interface CapturedRequest {
  eventId: string;
  params: URLSearchParams;
}

let capturedRequests: CapturedRequest[] = [];
let attendeesFetchCount = 0;
let zonesFetchCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/attendees", ({ request, params }) => {
    attendeesFetchCount += 1;
    const url = new URL(request.url);
    capturedRequests.push({ eventId: params.eventId as string, params: url.searchParams });
    return HttpResponse.json({
      attendees: [
        {
          id: "a1",
          event_id: params.eventId as string,
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
        },
      ],
      total: 1,
      page: Number(url.searchParams.get("page") ?? "1"),
      per_page: Number(url.searchParams.get("per_page") ?? "50"),
    });
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => {
    zonesFetchCount += 1;
    return HttpResponse.json([
      {
        id: "z1",
        event_id: "evt-1",
        name: "Main Hall",
        zone_type: "general",
        order_index: 0,
        is_registration_zone: true,
        requires_registration: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
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

describe("attendees hooks", () => {
  beforeEach(() => {
    capturedRequests = [];
    attendeesFetchCount = 0;
    zonesFetchCount = 0;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  describe("useAttendeesPage", () => {
    it("always sends page and per_page (defaulting per_page to 50), and omits search/zone/status when not given", async () => {
      const { result } = renderHook(() => useAttendeesPage("evt-1", { page: 1 }), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(capturedRequests).toHaveLength(1);
      const sent = capturedRequests[0]!.params;
      expect(sent.get("page")).toBe("1");
      expect(sent.get("per_page")).toBe("50");
      expect(sent.has("search")).toBe(false);
      expect(sent.has("zone")).toBe(false);
      expect(sent.has("status")).toBe(false);
    });

    it("sends search/zone/status when provided, and a custom per_page", async () => {
      const { result } = renderHook(
        () =>
          useAttendeesPage("evt-1", {
            page: 2,
            perPage: 25,
            search: "ada",
            zone: "zone-9",
            status: "checked_in",
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(capturedRequests).toHaveLength(1);
      const sent = capturedRequests[0]!.params;
      expect(sent.get("page")).toBe("2");
      expect(sent.get("per_page")).toBe("25");
      expect(sent.get("search")).toBe("ada");
      expect(sent.get("zone")).toBe("zone-9");
      expect(sent.get("status")).toBe("checked_in");
    });

    it("does not send an empty-string search param", async () => {
      const { result } = renderHook(() => useAttendeesPage("evt-1", { page: 1, search: "" }), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(capturedRequests[0]!.params.has("search")).toBe(false);
    });

    it("returns the envelope shape {attendees, total, page, per_page}", async () => {
      const { result } = renderHook(() => useAttendeesPage("evt-1", { page: 1 }), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.attendees).toHaveLength(1);
      expect(result.current.data?.attendees[0]?.first_name).toBe("Ada");
      expect(result.current.data?.total).toBe(1);
      expect(result.current.data?.page).toBe(1);
      expect(result.current.data?.per_page).toBe(50);
    });

    // P4.1 Task 7: ScanInput.tsx's manual-search fallback passes
    // `enabled: false` while its search box is empty, so the check-in
    // station doesn't fetch the roster's first page before the operator has
    // typed anything.
    it("does not fire the request at all when enabled is false", async () => {
      const { result } = renderHook(() => useAttendeesPage("evt-1", { page: 1, enabled: false }), { wrapper });

      // Give a (wrong) request a chance to fire before asserting its absence.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(attendeesFetchCount).toBe(0);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("defaults enabled to true when omitted", async () => {
      const { result } = renderHook(() => useAttendeesPage("evt-1", { page: 1 }), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(attendeesFetchCount).toBe(1);
    });
  });

  describe("ATTENDEES_LIST_KEY", () => {
    it("prefix-matches every page/search/zone/status variant for the same event, so invalidateQueries refetches all of them", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: page1 } = renderHook(() => useAttendeesPage("evt-1", { page: 1 }), { wrapper: Wrapper });
      const { result: page2Search } = renderHook(
        () => useAttendeesPage("evt-1", { page: 2, search: "ada" }),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(page1.current.isSuccess).toBe(true));
      await waitFor(() => expect(page2Search.current.isSuccess).toBe(true));
      expect(attendeesFetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY("evt-1") });

      await waitFor(() => expect(attendeesFetchCount).toBe(4));
    });

    it("does not match a different event's attendees query", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: evt1 } = renderHook(() => useAttendeesPage("evt-1", { page: 1 }), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useAttendeesPage("evt-2", { page: 1 }), { wrapper: Wrapper });

      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(attendeesFetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY("evt-1") });

      // Only evt-1's query should refetch; give evt-2 a beat to (not) refetch.
      await waitFor(() => expect(attendeesFetchCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(attendeesFetchCount).toBe(3);
    });
  });

  describe("useEventZones", () => {
    it("fetches and returns the zones array", async () => {
      const { result } = renderHook(() => useEventZones("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(zonesFetchCount).toBe(1);
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.name).toBe("Main Hall");
    });
  });

  describe("useBlockAttendee", () => {
    it("invalidates both the attendees list and the blocked attendee's detail query on success", async () => {
      server.use(
        http.post("http://api.test/api/attendees/:id/block", ({ params }) =>
          HttpResponse.json({ id: params.id, blocked: true, block_reason: "no-show" }),
        ),
      );
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useBlockAttendee("evt-1"), {
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
      });
      await act(async () => {
        await result.current.mutateAsync({ params: { path: { id: "att-1" } }, body: { reason: "no-show" } });
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEES_LIST_KEY("evt-1") });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEE_DETAIL_KEY("att-1") });
    });
  });

  describe("useUnblockAttendee", () => {
    it("invalidates both the attendees list and the unblocked attendee's detail query on success", async () => {
      server.use(
        http.post("http://api.test/api/attendees/:id/unblock", ({ params }) =>
          HttpResponse.json({ id: params.id, blocked: false, block_reason: null }),
        ),
      );
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useUnblockAttendee("evt-1"), {
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
      });
      await act(async () => {
        await result.current.mutateAsync({ params: { path: { id: "att-1" } } });
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEES_LIST_KEY("evt-1") });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEE_DETAIL_KEY("att-1") });
    });
  });
});
