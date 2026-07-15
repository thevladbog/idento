import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { ZONES_KEY, useEventZonesWithStats } from "./hooks";
import { useEventZones } from "../attendees/hooks";
import { startMswServer } from "../../test/msw";

interface CapturedRequest {
  eventId: string;
  params: URLSearchParams;
}

let capturedRequests: CapturedRequest[] = [];
let zonesFetchCount = 0;

function zoneWithStats(id: string, name: string) {
  return {
    zone: {
      id,
      event_id: "evt-1",
      name,
      zone_type: "general",
      order_index: 0,
      is_registration_zone: false,
      requires_registration: false,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    total_checkins: 0,
    today_checkins: 0,
    assigned_staff: 0,
    access_rules_count: 0,
  };
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/zones", ({ request, params }) => {
    zonesFetchCount += 1;
    const url = new URL(request.url);
    capturedRequests.push({ eventId: params.eventId as string, params: url.searchParams });
    // Mirrors the real backend: with_stats=true returns EventZoneWithStats[],
    // its absence returns plain EventZone[] — same union `getEventZones`
    // documents (schema.d.ts). Both variants must hit this ONE handler/path
    // so ZONES_KEY's prefix-match test below is exercising a real collision,
    // not two different mocked endpoints.
    if (url.searchParams.get("with_stats") === "true") {
      return HttpResponse.json([zoneWithStats("z1", "Main Hall")]);
    }
    return HttpResponse.json([
      {
        id: "z1",
        event_id: params.eventId as string,
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

describe("zones hooks", () => {
  beforeEach(() => {
    capturedRequests = [];
    zonesFetchCount = 0;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  describe("useEventZonesWithStats", () => {
    it("sends with_stats=true and returns the EventZoneWithStats array", async () => {
      const { result } = renderHook(() => useEventZonesWithStats("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(capturedRequests[0]?.params.get("with_stats")).toBe("true");
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.zone.name).toBe("Main Hall");
      expect(result.current.data?.[0]?.access_rules_count).toBe(0);
    });
  });

  describe("ZONES_KEY", () => {
    it("prefix-matches both the with_stats query and the plain zones query for the same event, so invalidateQueries refetches both", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: stats } = renderHook(() => useEventZonesWithStats("evt-1"), { wrapper: Wrapper });
      const { result: plain } = renderHook(() => useEventZones("evt-1"), { wrapper: Wrapper });

      await waitFor(() => expect(stats.current.isSuccess).toBe(true));
      await waitFor(() => expect(plain.current.isSuccess).toBe(true));
      expect(zonesFetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: ZONES_KEY("evt-1") });

      await waitFor(() => expect(zonesFetchCount).toBe(4));
    });

    it("does not match a different event's zones query", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: evt1 } = renderHook(() => useEventZonesWithStats("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useEventZonesWithStats("evt-2"), { wrapper: Wrapper });

      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(zonesFetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: ZONES_KEY("evt-1") });

      await waitFor(() => expect(zonesFetchCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(zonesFetchCount).toBe(3);
    });
  });
});
