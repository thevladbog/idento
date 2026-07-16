import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { BADGE_TEMPLATE_KEY } from "./hooks";
import { useSaveTemplate } from "./useSaveTemplate";
import { useEventReadiness } from "../events/hooks";
import { useBadgeTemplate } from "./hooks";
import { startMswServer } from "../../test/msw";

let templateFetchCount = 0;
let readinessFetchCount = 0;
// Codex round (Fix 3): holds back the GET so a test can observe the SEEDED
// cache entry (the PUT's own response) before the invalidation-triggered
// refetch — which this fixture's GET always answers with a FIXED version:3,
// distinct from whatever the save bumped it to — has a chance to resolve
// and clobber it.
let getDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/badge-template", async () => {
    templateFetchCount += 1;
    if (getDelayMs) await delay(getDelayMs);
    return HttpResponse.json({ template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 3 });
  }),
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessFetchCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
  http.put("http://api.test/api/events/:id/badge-template", async ({ request }) => {
    const body = (await request.json()) as { template: Record<string, unknown>; version: number };
    return HttpResponse.json({ template: body.template, version: body.version + 1 });
  }),
);
void server;

describe("useSaveTemplate", () => {
  beforeEach(() => {
    templateFetchCount = 0;
    readinessFetchCount = 0;
    getDelayMs = 0;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  // Genuinely subscribed observers, same ReadinessObserver pattern as
  // AddAttendeeDialog.test.tsx / PR #70's fix commits: mounting real
  // useBadgeTemplate/useEventReadiness consumers alongside the mutation
  // makes a successful PUT produce an OBSERVABLE refetch (hit counts
  // bumping), not just an asserted `invalidateQueries` call.
  function Harness({ eventId }: { eventId: string }) {
    useBadgeTemplate(eventId);
    useEventReadiness(eventId);
    return null;
  }

  it("unconditionally invalidates BADGE_TEMPLATE_KEY and READINESS_KEY for the event on a successful save", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <Harness eventId="evt-1" />
          {children}
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useSaveTemplate(), { wrapper });

    await waitFor(() => expect(templateFetchCount).toBe(1));
    await waitFor(() => expect(readinessFetchCount).toBe(1));

    result.current.mutate({
      params: { path: { id: "evt-1" } },
      body: { template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 3 },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(templateFetchCount).toBeGreaterThan(1));
    await waitFor(() => expect(readinessFetchCount).toBeGreaterThan(1));
  });

  // Codex round Fix 3.
  it("seeds BADGE_TEMPLATE_KEY with the mutation's own {template, version} response, ahead of the invalidated refetch", async () => {
    getDelayMs = 100; // holds back the invalidation-triggered GET refetch
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useSaveTemplate(), { wrapper });
    const savedTemplate = { width_mm: 90, height_mm: 55, dpi: 300, elements: [{ id: "e1", type: "text", x: 1, y: 1 }] };
    result.current.mutate({ params: { path: { id: "evt-1" } }, body: { template: savedTemplate, version: 3 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Asserted immediately (no lenient waitFor): the fixture's GET mock
    // always answers with a FIXED `version: 3` regardless of any save, so if
    // the seed didn't happen and this instead reads through to the (slow,
    // held-back) refetch once it eventually resolves, the mismatch — the PUT
    // bumped to version 4 — would only surface as a hang/timeout rather than
    // a clean, fast failure. Reading the cache directly and synchronously
    // right after `isSuccess` is what actually distinguishes "seeded from
    // the response" from "coincidentally correct once the network catches
    // up".
    expect(queryClient.getQueryData(BADGE_TEMPLATE_KEY("evt-1"))).toEqual({ template: savedTemplate, version: 4 });
  });
});
