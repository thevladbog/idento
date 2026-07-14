import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { useCreateEvent, useEventReadiness, useEventsQuery, useEventStats } from "./hooks";

let eventsGetCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events", () => {
    eventsGetCount += 1;
    return HttpResponse.json([{ id: "e1", tenant_id: "t1", name: "Conf", created_at: "", updated_at: "" }]);
  }),
  http.post("http://api.test/api/events", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      { id: "e2", tenant_id: "t1", name: body.name, created_at: "", updated_at: "" },
      { status: 201 },
    );
  }),
  http.get("http://api.test/api/events/:eventId/stats", () =>
    HttpResponse.json({ total_attendees: 10, checked_in: 3 }),
  ),
  http.get("http://api.test/api/events/:id/readiness", () =>
    HttpResponse.json({
      ready: false,
      steps: [{ key: "attendees", status: "done", count: 10 }],
    }),
  ),
);
void server;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Shared wrapper factory so a single QueryClient instance is reused within a
// test (required for the invalidate-on-mutate test, which needs the
// mutation and the query to share a cache).
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

describe("event hooks", () => {
  beforeEach(() => {
    eventsGetCount = 0;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("useEventsQuery returns the events list", async () => {
    const { result } = renderHook(() => useEventsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.name).toBe("Conf");
  });

  it("useCreateEvent posts a new event and invalidates the events list, triggering a refetch", async () => {
    const { Wrapper } = makeWrapper();
    const { result: listResult } = renderHook(() => useEventsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
    expect(eventsGetCount).toBe(1);

    const { result: mutationResult } = renderHook(() => useCreateEvent(), { wrapper: Wrapper });
    mutationResult.current.mutate({ body: { name: "New Event" } });
    await waitFor(() => expect(mutationResult.current.isSuccess).toBe(true));
    expect(mutationResult.current.data?.name).toBe("New Event");

    await waitFor(() => expect(eventsGetCount).toBe(2));
  });

  it("useEventStats(id, {poll:true}) resolves stats data", async () => {
    const { result } = renderHook(() => useEventStats("evt-1", { poll: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_attendees).toBe(10);
  });

  it("useEventReadiness resolves the readiness aggregate", async () => {
    const { result } = renderHook(() => useEventReadiness("evt-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.ready).toBe(false);
    expect(result.current.data?.steps[0]?.key).toBe("attendees");
  });
});
