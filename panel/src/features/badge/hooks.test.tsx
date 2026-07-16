import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { BADGE_TEMPLATE_KEY, useBadgeTemplate } from "./hooks";
import { startMswServer } from "../../test/msw";

interface CapturedRequest {
  eventId: string;
}

let capturedRequests: CapturedRequest[] = [];
let fetchCount = 0;

function templateResponse(eventId: string) {
  return {
    template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [], eventId },
    version: 3,
  };
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/badge-template", ({ params }) => {
    fetchCount += 1;
    const eventId = params.eventId as string;
    capturedRequests.push({ eventId });
    return HttpResponse.json(templateResponse(eventId));
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

describe("badge hooks", () => {
  beforeEach(() => {
    capturedRequests = [];
    fetchCount = 0;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  describe("useBadgeTemplate", () => {
    it("fetches GET /api/events/{id}/badge-template for the given event id", async () => {
      const { result } = renderHook(() => useBadgeTemplate("evt-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(capturedRequests).toEqual([{ eventId: "evt-1" }]);
      expect(result.current.data?.version).toBe(3);
      expect(result.current.data?.template).toEqual({
        width_mm: 90,
        height_mm: 55,
        dpi: 300,
        elements: [],
        eventId: "evt-1",
      });
    });
  });

  describe("BADGE_TEMPLATE_KEY", () => {
    it("invalidating an event's key refetches only that event's badge-template query", async () => {
      const { qc, Wrapper } = makeWrapper();

      const { result: evt1 } = renderHook(() => useBadgeTemplate("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useBadgeTemplate("evt-2"), { wrapper: Wrapper });

      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(fetchCount).toBe(2);

      await qc.invalidateQueries({ queryKey: BADGE_TEMPLATE_KEY("evt-1") });

      await waitFor(() => expect(fetchCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchCount).toBe(3);
    });
  });
});
