import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import {
  STAFF_KEY, USER_ZONES_KEY, useEventStaff, useUserZoneAssignments,
} from "./hooks";
import { startMswServer } from "../../test/msw";

let staffFetchCount = 0;
let staffFetchedEventIds: string[] = [];
let zonesFetchCount = 0;
let zonesFetchedUserIds: string[] = [];

function staffUser(id: string, email: string, role: "admin" | "manager" | "staff" = "staff") {
  return {
    id,
    tenant_id: "t1",
    email,
    role,
    is_super_admin: false,
    has_qr_token: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/staff", ({ params }) => {
    staffFetchCount += 1;
    staffFetchedEventIds.push(params.eventId as string);
    return HttpResponse.json([staffUser("u1", "alice@example.com")]);
  }),
  http.get("http://api.test/api/users/:userId/zones", ({ params }) => {
    zonesFetchCount += 1;
    zonesFetchedUserIds.push(params.userId as string);
    return HttpResponse.json([
      {
        id: "a1", user_id: params.userId as string, zone_id: "z1", assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin",
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

describe("staff hooks", () => {
  beforeEach(() => {
    staffFetchCount = 0;
    staffFetchedEventIds = [];
    zonesFetchCount = 0;
    zonesFetchedUserIds = [];
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  describe("useEventStaff", () => {
    it("fetches the given event's staff, capturing the event id in the URL", async () => {
      const { result } = renderHook(() => useEventStaff("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(staffFetchedEventIds).toEqual(["evt-1"]);
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.email).toBe("alice@example.com");
      expect(result.current.data?.[0]?.role).toBe("staff");
    });
  });

  describe("STAFF_KEY", () => {
    it("invalidating one event's key refetches only that event's staff query", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: evt1 } = renderHook(() => useEventStaff("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useEventStaff("evt-2"), { wrapper: Wrapper });

      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(staffFetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: STAFF_KEY("evt-1") });

      await waitFor(() => expect(staffFetchCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(staffFetchCount).toBe(3);
    });
  });

  describe("useUserZoneAssignments", () => {
    it("fetches the given user's zone assignments, capturing the user id in the URL", async () => {
      const { result } = renderHook(() => useUserZoneAssignments("u1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(zonesFetchedUserIds).toEqual(["u1"]);
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.zone_id).toBe("z1");
    });
  });

  describe("USER_ZONES_KEY", () => {
    it("invalidating one user's key refetches only that user's zone-assignments query", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: u1 } = renderHook(() => useUserZoneAssignments("u1"), { wrapper: Wrapper });
      const { result: u2 } = renderHook(() => useUserZoneAssignments("u2"), { wrapper: Wrapper });

      await waitFor(() => expect(u1.current.isSuccess).toBe(true));
      await waitFor(() => expect(u2.current.isSuccess).toBe(true));
      expect(zonesFetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: USER_ZONES_KEY("u1") });

      await waitFor(() => expect(zonesFetchCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(zonesFetchCount).toBe(3);
    });
  });
});
