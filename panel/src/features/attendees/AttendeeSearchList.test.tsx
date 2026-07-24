import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AttendeeSearchList } from "./AttendeeSearchList";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// `position` is a non-optional string on the generated `Attendee` schema
// (panel/src/shared/api/schema.d.ts) — the brief's placeholder fixture
// omitted it; added here (and matches AttendeeTable.test.tsx / hooks.test.tsx's
// existing fixture convention of a plain job-title string).
const ATTENDEES = [
  {
    id: "att-1", event_id: "evt-1", first_name: "Дмитрий", last_name: "Иванов", email: "d@x.com",
    company: "Яндекс", position: "Engineer", code: "QR-10482", checkin_status: true, checked_in_at: "2026-01-01T10:42:00Z",
    printed_count: 1, blocked: false, packet_delivered: false, created_at: "", updated_at: "",
  },
  {
    id: "att-2", event_id: "evt-1", first_name: "Мария", last_name: "Иванова", email: "m@x.com",
    company: "ВТБ", position: "Manager", code: "QR-11730", checkin_status: false, printed_count: 0, blocked: false,
    packet_delivered: false, created_at: "", updated_at: "",
  },
  {
    id: "att-3", event_id: "evt-1", first_name: "Павел", last_name: "Иванченко", email: "p@x.com",
    company: "Freelance", position: "Consultant", code: "QR-12064", checkin_status: false, printed_count: 0, blocked: true,
    block_reason: "test", packet_delivered: false, created_at: "", updated_at: "",
  },
];

// Registered with no default handlers (matches import/ImportWizard.test.tsx's
// convention) — each test installs its own GET /attendees handler via
// `server.use()` below, since the three tests want three different
// envelopes. The brief's own draft called `startMswServer(...)` from
// *inside* each `it()` body instead: that registers the server's
// beforeAll/afterEach/afterAll hooks mid-test-execution (too late for
// beforeAll to run before the request fires), so MSW never intercepted and
// every request fell through to a real (failing, ENOTFOUND) network call —
// reproduced empirically before this fix. Every other suite in this
// codebase (AttendeesPage.test.tsx, hooks.test.tsx, etc.) calls
// startMswServer exactly once, at describe/module scope.
const server = startMswServer();

function renderList(overrides?: Partial<React.ComponentProps<typeof AttendeeSearchList>>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRowClick = vi.fn();
  const onSearchChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AttendeeSearchList eventId="evt-1" search="иван" onRowClick={onRowClick} onSearchChange={onSearchChange} {...overrides} />
    </QueryClientProvider>,
  );
  return { onRowClick, onSearchChange };
}

describe("AttendeeSearchList", () => {
  // Every other suite that hits a real endpoint via $api (AttendeesPage.test.tsx,
  // hooks.test.tsx, AddAttendeeDialog.test.tsx, etc.) sets this in beforeEach —
  // shared/api/client.ts reads window.__ENV__.API_URL fresh per request, and it
  // isn't defaulted anywhere in test/setup.ts. The brief's own test body omitted
  // this; without it every request resolves against no configured base URL and
  // MSW's handlers (registered against http://api.test) never match, so every
  // row silently renders the "No matches" empty state instead of the fixture
  // data. Added here, not adjusted per the brief's own fixture note, but is the
  // same category of "align with the real harness" fix.
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("renders one row per result with name, company/code caption and a status pill matching checked-in/not/blocked", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/attendees", () =>
        HttpResponse.json({ attendees: ATTENDEES, total: 3, page: 1, per_page: 50 }),
      ),
    );
    renderList();
    expect(await screen.findByText(/Иванов Дмитрий/)).toBeInTheDocument();
    expect(screen.getByText(/Яндекс.*QR-10482/)).toBeInTheDocument();
    expect(screen.getByText("Checked in")).toBeInTheDocument();
    expect(screen.getByText("Not checked in")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("calls onRowClick with the attendee id when a row is activated", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/attendees", () =>
        HttpResponse.json({ attendees: ATTENDEES, total: 3, page: 1, per_page: 50 }),
      ),
    );
    const { onRowClick } = renderList();
    const user = userEvent.setup();
    await user.click(await screen.findByText(/Иванов Дмитрий/));
    expect(onRowClick).toHaveBeenCalledWith("att-1");
  });

  it("shows a no-matches state without a bulk/import affordance", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/attendees", () => HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 })),
    );
    renderList();
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import/i })).not.toBeInTheDocument();
  });

  // A real venue's flaky Wi-Fi during check-in is exactly when staff would
  // hit this: an errored query must not be indistinguishable from a
  // genuinely empty search result -- same error/retry pattern
  // AttendeesPage.tsx's desktop AttendeeTable branch already uses for this
  // exact query (attendeesLoadError + retry, not a new key pair).
  it("shows an error state with a retry affordance instead of a misleading no-matches message when the query fails", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/attendees", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderList();
    expect(await screen.findByText("Couldn't load attendees.")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
