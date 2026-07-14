import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { HomePage } from "./HomePage";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type ApiEvent = components["schemas"]["Event"];

function apiEvent(overrides: Partial<ApiEvent> & { id: string; name: string }): ApiEvent {
  return { tenant_id: "t1", created_at: "", updated_at: "", ...overrides };
}

// HomePage renders `Link`s (via LiveStrip and EventRow), which need a router
// context to resolve hrefs — same minimal single-route harness LiveStrip's
// own tests use.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  );
}

// Absolute, "always in the past/future" offsets from the actual test-run
// clock (rather than fixed calendar dates) so this suite never rots into a
// flaky "that date is now in the past" failure.
const NOW = Date.now();
const DAY = 86_400_000;
function isoDaysFromNow(days: number): string {
  return new Date(NOW + days * DAY).toISOString();
}

// Registered once for the whole file — every row (UpcomingRow/PastRow/
// LiveStrip) fans out its own readiness/stats fetch keyed by event id, and
// these generic `:id`/`:eventId` handlers answer all of them identically.
// Only `GET /api/events` varies per test, via `server.use(...)`.
const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () =>
    HttpResponse.json({
      ready: false,
      steps: [
        { key: "attendees", status: "done", count: 5 },
        { key: "badge", status: "not_done" },
        { key: "zones", status: "skipped" },
        { key: "staff", status: "not_done" },
        { key: "equipment", status: "not_done" },
      ],
    }),
  ),
  http.get("http://api.test/api/events/:eventId/stats", () =>
    HttpResponse.json({ total_attendees: 100, checked_in: 40 }),
  ),
);

describe("HomePage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("renders the empty state with a create CTA when there are no events", async () => {
    server.use(http.get("http://api.test/api/events", () => HttpResponse.json([])));
    renderWithProviders(<HomePage />);

    expect(await screen.findByText("No events yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first event to start importing attendees and printing badges."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeInTheDocument();
  });

  it("renders LiveStrip + both sections with the correct row counts when a running event exists", async () => {
    const events: ApiEvent[] = [
      apiEvent({
        id: "evt-run",
        name: "Live Expo",
        start_date: isoDaysFromNow(-1 / 24), // started an hour ago
        end_date: isoDaysFromNow(1 / 24), // ends an hour from now
      }),
      apiEvent({ id: "evt-up1", name: "Upcoming One", start_date: isoDaysFromNow(10) }),
      apiEvent({ id: "evt-up2", name: "Upcoming Two", start_date: isoDaysFromNow(20) }),
      apiEvent({ id: "evt-past1", name: "Past One", start_date: isoDaysFromNow(-10) }),
      apiEvent({ id: "evt-past2", name: "Past Two", start_date: isoDaysFromNow(-20) }),
    ];
    server.use(http.get("http://api.test/api/events", () => HttpResponse.json(events)));
    renderWithProviders(<HomePage />);

    // LiveStrip shows the running event (a running event always wins over
    // any upcoming one for the hero slot).
    expect(await screen.findByText("Live Expo")).toBeInTheDocument();
    expect(screen.getByText("LIVE NOW")).toBeInTheDocument();

    // Upcoming list keeps BOTH upcoming events — no dedup needed, since the
    // hero slot is occupied by the running event, not by upcoming[0].
    const upcomingList = within(await screen.findByTestId("home-upcoming-list"));
    expect(upcomingList.getByText("Upcoming One")).toBeInTheDocument();
    expect(upcomingList.getByText("Upcoming Two")).toBeInTheDocument();
    expect(upcomingList.getAllByRole("link")).toHaveLength(2);

    // Past list holds both past events, dimmed container.
    const pastList = within(await screen.findByTestId("home-past-list"));
    expect(pastList.getByText("Past One")).toBeInTheDocument();
    expect(pastList.getByText("Past Two")).toBeInTheDocument();
    expect(pastList.getAllByRole("link")).toHaveLength(2);
  });

  it("promotes upcoming[0] into the LiveStrip hero and excludes it from the Upcoming list when nothing is running", async () => {
    const events: ApiEvent[] = [
      apiEvent({ id: "evt-a", name: "Event A", start_date: isoDaysFromNow(5) }),
      apiEvent({ id: "evt-b", name: "Event B", start_date: isoDaysFromNow(10) }),
      apiEvent({ id: "evt-c", name: "Event C", start_date: isoDaysFromNow(15) }),
    ];
    server.use(http.get("http://api.test/api/events", () => HttpResponse.json(events)));
    renderWithProviders(<HomePage />);

    // "Event A" (upcoming[0], earliest start_date) is promoted into the
    // hero — confirmed by the "Next up" label LiveStrip's UpcomingCard
    // renders only in that fallback state.
    expect(await screen.findByText("Next up")).toBeInTheDocument();
    expect(screen.getByText("Event A")).toBeInTheDocument();

    // It must NOT also appear as a row in the Upcoming list — only once,
    // total, anywhere in the document.
    expect(screen.getAllByText("Event A")).toHaveLength(1);

    const upcomingList = within(await screen.findByTestId("home-upcoming-list"));
    expect(upcomingList.getByText("Event B")).toBeInTheDocument();
    expect(upcomingList.getByText("Event C")).toBeInTheDocument();
    expect(upcomingList.queryByText("Event A")).not.toBeInTheDocument();
    expect(upcomingList.getAllByRole("link")).toHaveLength(2);

    // No past events in this fixture -> no Past section at all.
    expect(screen.queryByTestId("home-past-list")).not.toBeInTheDocument();
  });
});
