import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { LiveStrip } from "./LiveStrip";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type ApiEvent = components["schemas"]["Event"];

function apiEvent(overrides: Partial<ApiEvent> & { id: string; name: string }): ApiEvent {
  return { tenant_id: "t1", created_at: "", updated_at: "", ...overrides };
}

// LiveStrip renders a `Link` to `/events/$eventId`, which needs a router
// context to resolve — same minimal single-route harness LoginScreen.test.tsx
// uses (these tests exercise LiveStrip's own rendering, not routing).
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  );
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/stats", () =>
    HttpResponse.json({
      total_attendees: 200,
      checked_in: 120,
      zone_stats: { allowed: 100, no_access: 15, not_registered: 5 },
    }),
  ),
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
  });

  it("renders the running-event card: LIVE NOW pill, name, checked-in counter, progress bar, Open-event link", async () => {
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

    const link = screen.getByRole("link", { name: /Open event/ });
    expect(link).toHaveAttribute("href", "/events/evt-running");

    // zone_stats is a per-VERDICT breakdown (allowed/no_access/not_registered),
    // never per-zone-name — asserting the honest verdict labels render, and
    // that no fabricated zone name (e.g. "Main hall") ever appears.
    expect(await screen.findByText(/100/)).toBeInTheDocument();
    expect(screen.queryByText(/Main hall/i)).not.toBeInTheDocument();
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

  it("shows a loading state (not fabricated zero check-ins) while stats are still loading", () => {
    const running = apiEvent({
      id: "evt-loading",
      name: "Loading Event",
      start_date: "2026-07-14T09:00:00Z",
      end_date: "2026-07-14T18:00:00Z",
    });
    renderWithProviders(<LiveStrip running={running} nextUpcoming={undefined} />);

    // Before the MSW-mocked stats response resolves, the real counter/progress
    // bar must not be visible with a misleading "0 / 0".
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows an error message (not fabricated zero check-ins) when stats fail to load", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/stats", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
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
