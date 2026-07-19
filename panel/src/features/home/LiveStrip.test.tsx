import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { LiveStrip } from "./LiveStrip";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type ApiEvent = components["schemas"]["Event"];
type MonitorSnapshot = components["schemas"]["MonitorSnapshot"];

function apiEvent(overrides: Partial<ApiEvent> & { id: string; name: string }): ApiEvent {
  return { tenant_id: "t1", created_at: "", updated_at: "", ...overrides };
}

// LiveStrip renders `Link`s to `/events/$eventId` and `/events/$eventId/monitor`,
// which need a router context to resolve — same minimal single-route harness
// LoginScreen.test.tsx uses (these tests exercise LiveStrip's own rendering,
// not routing). `Link`'s `to` prop type-checks against the REAL registered
// router (app/router.tsx's module augmentation), not this local test router,
// so an unregistered-here-but-real route still type-checks and resolves an
// href via path interpolation.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  );
  // `queryClient` returned alongside the RTL render result (PR #81 bot
  // round Finding C6) so a test can trigger an explicit background refetch
  // via `queryClient.invalidateQueries()` -- same exposed-QueryClient +
  // `server.use` MSW-override idiom as MonitorPage.test.tsx's own C6 tests
  // (and BadgeEditorPage.test.tsx's background-refetch precedent) -- rather
  // than a fresh remount, which would prove nothing about retaining
  // ALREADY-rendered stale data.
  return { ...result, queryClient };
}

function monitorSnapshotBody(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    totals: { checked_in: 120, total: 200, rate_per_min: 3.4, peak: null, est_done_at: null },
    zones: [
      { zone_id: "z-main", name: "Main hall", checked_in: 100 },
      { zone_id: "z-vip", name: "VIP", checked_in: 15 },
    ],
    unattributed: 5,
    stations: [],
    recent: [],
    ...overrides,
  };
}

// Task 9 -- RunningCard mounts `useMonitorStream`, which opens a fetch-
// streaming connection to `.../monitor/stream` unconditionally (same "mock
// every endpoint this page/card hits" discipline MonitorPage.test.tsx's own
// `monitorStreamHandler` documents) -- an empty, never-closing stream is
// enough since these tests don't assert live-pill/reconnect nuances (that's
// MonitorPage's own concern).
function monitorStreamHandler() {
  return http.get("http://api.test/api/events/:eventId/monitor/stream", () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
  });
}

let statsGetCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/monitor", () => HttpResponse.json(monitorSnapshotBody())),
  monitorStreamHandler(),
  // Task 9 dropped RunningCard's `useEventStats(poll)` call entirely -- this
  // handler stays registered (not removed) specifically so the "no /stats
  // request" test below has something concrete to count against, rather
  // than a negative assertion that would pass just as well if the endpoint
  // were unmocked (MSW's `onUnhandledRequest: "error"` would only catch a
  // stray call if the harness happened to hit an unmocked URL by accident,
  // not prove the absence of a request to a URL that IS mocked).
  http.get("http://api.test/api/events/:eventId/stats", () => {
    statsGetCount += 1;
    return HttpResponse.json({ total_attendees: 200, checked_in: 120 });
  }),
  http.get("http://api.test/api/events/:id/readiness", () =>
    HttpResponse.json({
      ready: false,
      steps: [
        { key: "attendees", status: "done", count: 10 },
        { key: "badge", status: "not_done" },
        { key: "zones", status: "skipped" },
        { key: "staff", status: "done" },
        { key: "equipment", status: "not_done" },
      ],
    }),
  ),
);
void server;

describe("LiveStrip", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    statsGetCount = 0;
  });

  it("renders the running-event card: LIVE NOW pill, name, checked-in counter, progress bar, Open-event link, Open-monitor link", async () => {
    const running = apiEvent({
      id: "evt-running",
      name: "Tech Summit",
      location: "Expocentre, Hall 4",
      start_date: "2026-07-14T09:00:00Z",
      end_date: "2026-07-14T18:00:00Z",
    });
    renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    expect(screen.getByText("LIVE NOW")).toBeInTheDocument();
    expect(screen.getByText("Tech Summit")).toBeInTheDocument();
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText(/200/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    const openEventLink = screen.getByRole("link", { name: /Open event/ });
    expect(openEventLink).toHaveAttribute("href", "/events/evt-running");

    const openMonitorLink = screen.getByRole("link", { name: /Open monitor/ });
    expect(openMonitorLink).toHaveAttribute("href", "/events/evt-running/monitor");

    // Counters/progress now come from the monitor snapshot (Task 5/6), not
    // the old per-verdict `zone_stats` read -- this is real zone-NAME data,
    // so it's expected (and required) to render actual zone names now,
    // unlike the pre-Task-9 test which asserted the opposite.
    expect(await screen.findByTestId("home-zone-z-main")).toHaveTextContent("Main hall: 100");
    expect(screen.getByTestId("home-zone-z-vip")).toHaveTextContent("VIP: 15");

    // unattributed = 5 (> 0) in this fixture -- the mini zone line includes it.
    expect(screen.getByTestId("home-zone-unattributed")).toHaveTextContent("Unattributed: 5");

    // Binding regression: RunningCard must never hit the old per-event stats
    // endpoint anymore.
    expect(statsGetCount).toBe(0);
  });

  it("omits the unattributed mini-line when unattributed is 0", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor", () =>
        HttpResponse.json(
          monitorSnapshotBody({
            zones: [{ zone_id: "z-main", name: "Main hall", checked_in: 120 }],
            unattributed: 0,
          }),
        ),
      ),
    );
    const running = apiEvent({
      id: "evt-no-unattributed",
      name: "Perfect Coverage Event",
      start_date: "2026-07-14T09:00:00Z",
      end_date: "2026-07-14T18:00:00Z",
    });
    renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    expect(await screen.findByTestId("home-zone-z-main")).toHaveTextContent("Main hall: 120");
    expect(screen.queryByTestId("home-zone-unattributed")).not.toBeInTheDocument();
  });

  it("shows an 'All day' label instead of a fabricated midnight time range for a date-only running event", async () => {
    // Both dates are the create dialog's UTC-midnight all-day placeholders —
    // no real time was ever entered, so formatting them as a "12:00 AM–12:00
    // AM" time range would show a time no one chose.
    const running = apiEvent({
      id: "evt-allday",
      name: "All-Day Fest",
      start_date: "2026-07-14T00:00:00.000Z",
      end_date: "2026-07-14T00:00:00.000Z",
    });
    renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    expect(await screen.findByText("All day")).toBeInTheDocument();
    expect(screen.queryByText(/12:00 AM/)).not.toBeInTheDocument();
  });

  it("shows a loading state (not fabricated zero check-ins) while the monitor snapshot is still loading", () => {
    const running = apiEvent({
      id: "evt-loading",
      name: "Loading Event",
      start_date: "2026-07-14T09:00:00Z",
      end_date: "2026-07-14T18:00:00Z",
    });
    renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    // Before the MSW-mocked snapshot response resolves, the real counter/
    // progress bar/zone line must not be visible with misleading fabricated
    // values.
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Unattributed/)).not.toBeInTheDocument();
  });

  it("shows an error message (not fabricated zero check-ins) when the monitor snapshot fails to load", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/monitor", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const running = apiEvent({
      id: "evt-stats-error",
      name: "Broken Stats Event",
      start_date: "2026-07-14T09:00:00Z",
      end_date: "2026-07-14T18:00:00Z",
    });
    renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    expect(await screen.findByText("Couldn't load live stats.")).toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  // PR #81 bot round Finding C6: retain-last-known-good. A single failed
  // BACKGROUND refetch (isError=true, data still retained per react-query)
  // must not blank an already-successfully-rendered card into the error
  // message above -- exercised via the exposed-`queryClient` +
  // `server.use` MSW-override + explicit `invalidateQueries()` idiom (not
  // a fresh remount, which would prove nothing about retaining ALREADY-
  // rendered content).
  it("keeps rendering the counters/progress/zone line after a background snapshot refetch fails", async () => {
    const running = apiEvent({
      id: "evt-stale-refetch",
      name: "Still Running Event",
      start_date: "2026-07-14T09:00:00Z",
      end_date: "2026-07-14T18:00:00Z",
    });
    const { queryClient } = renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByTestId("home-zone-z-main")).toHaveTextContent("Main hall: 100");

    server.use(
      http.get("http://api.test/api/events/:eventId/monitor", () => new HttpResponse(null, { status: 500 })),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/events/{event_id}/monitor"] });
    });

    // `getBy` (not `findBy`) proves this is the SAME still-mounted content,
    // not a fresh success re-render -- the failed refetch must not have
    // replaced it with "Couldn't load live stats."
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("home-zone-z-main")).toHaveTextContent("Main hall: 100");
    expect(screen.queryByText("Couldn't load live stats.")).not.toBeInTheDocument();
  });

  it("renders the upcoming-fallback hero when nothing is running", async () => {
    const upcoming = apiEvent({
      id: "evt-upcoming",
      name: "Product Launch",
      start_date: "2026-09-03T09:00:00Z",
      end_date: "2026-09-03T18:00:00Z",
    });
    renderWithProviders(<LiveStrip running={undefined} nextUpcoming={upcoming} />);

    expect(screen.getByText("Product Launch")).toBeInTheDocument();
    // readiness mock: attendees=done, badge=not_done, zones=skipped, staff=done, equipment=not_done
    // -> 2 done out of 4 non-skipped steps.
    expect(await screen.findByText("2 of 4 ready")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Open event/ });
    expect(link).toHaveAttribute("href", "/events/evt-upcoming");

    // UpcomingCard regression: Task 9 is RunningCard-only -- no monitor CTA
    // or snapshot data on the upcoming-fallback card.
    expect(screen.queryByRole("link", { name: /Open monitor/ })).not.toBeInTheDocument();
  });

  it("renders nothing when there is neither a running nor an upcoming event", () => {
    const { container } = renderWithProviders(<LiveStrip running={undefined} nextUpcoming={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  // `start_date` is a bare calendar date stored as a UTC-midnight ISO
  // timestamp (see CreateEventDialog) — the upcoming-fallback card's date
  // must render the SAME calendar day regardless of the viewer's local
  // timezone. Stubbing TZ to a zone behind UTC (America/Los_Angeles,
  // UTC-7/8) is what actually exercises the bug: at exactly UTC, or at any
  // zone ahead of UTC, "2026-08-15T00:00:00.000Z" already prints as "Aug
  // 15" even without the `timeZone: "UTC"` pin, so only a behind-UTC zone
  // can tell a correct formatter apart from a broken one here.
  it("keeps the upcoming-fallback card's date stable for a viewer behind UTC", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const upcoming = apiEvent({
        id: "evt-tz",
        name: "Timezone Test Event",
        start_date: "2026-08-15T00:00:00.000Z",
      });
      renderWithProviders(<LiveStrip running={undefined} nextUpcoming={upcoming} />);

      expect(await screen.findByText("Timezone Test Event")).toBeInTheDocument();
      expect(screen.getByText("Aug 15, 2026")).toBeInTheDocument();
      expect(screen.queryByText("Aug 14, 2026")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
