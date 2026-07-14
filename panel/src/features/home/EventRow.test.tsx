import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { PastRow, UpcomingRow } from "./EventRow";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type ApiEvent = components["schemas"]["Event"];

function apiEvent(overrides: Partial<ApiEvent> & { id: string; name: string }): ApiEvent {
  return { tenant_id: "t1", created_at: "", updated_at: "", ...overrides };
}

// UpcomingRow/PastRow render `Link`s, which need a router context to
// resolve — same minimal single-route harness LiveStrip.test.tsx uses.
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
void server;

describe("EventRow date formatting", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  // `start_date` is a bare calendar date stored as a UTC-midnight ISO
  // timestamp (see CreateEventDialog), so both row variants must render the
  // SAME calendar day regardless of the viewer's local timezone. Stubbing
  // TZ to a zone behind UTC (America/Los_Angeles, UTC-7/8) is what actually
  // exercises the bug: at exactly UTC, or at any zone ahead of UTC,
  // "2026-08-15T00:00:00.000Z" already prints as "Aug 15" even without the
  // `timeZone: "UTC"` pin, so only a behind-UTC zone can tell a correct
  // formatter apart from a broken one here.
  it("UpcomingRow keeps its date column stable for a viewer behind UTC", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const event = apiEvent({ id: "evt-up-tz", name: "Timezone Test Event", start_date: "2026-08-15T00:00:00.000Z" });
      renderWithProviders(<UpcomingRow event={event} />);

      expect(await screen.findByText("Timezone Test Event")).toBeInTheDocument();
      expect(screen.getByText("Aug 15, 2026")).toBeInTheDocument();
      expect(screen.queryByText("Aug 14, 2026")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("PastRow keeps its date column stable for a viewer behind UTC", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const event = apiEvent({ id: "evt-past-tz", name: "Timezone Test Event", start_date: "2026-08-15T00:00:00.000Z" });
      renderWithProviders(<PastRow event={event} />);

      expect(screen.getByText("Timezone Test Event")).toBeInTheDocument();
      expect(screen.getByText("Aug 15, 2026")).toBeInTheDocument();
      expect(screen.queryByText("Aug 14, 2026")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
