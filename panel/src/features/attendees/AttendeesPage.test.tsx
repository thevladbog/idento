import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import {
  fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AttendeesPage } from "./AttendeesPage";
import { validateAttendeesSearch } from "./searchParams";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Mirrors EventSettingsPage.test.tsx / EventWorkspaceLayout.test.tsx's
// harness shape: a throwaway route tree whose id/path structure matches the
// real app closely enough for `getRouteApi("/_app/events/$eventId/attendees")`
// (params AND typed search) to resolve. `validateAttendeesSearch` is
// imported from the real module (not re-implemented here) so this harness
// can never drift from what app/router.tsx actually registers.
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const attendeesRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/attendees",
    validateSearch: validateAttendeesSearch,
    component: AttendeesPage,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([attendeesRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton — same rationale as
          EventSettingsPage.test.tsx / EventWorkspaceLayout.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

interface CapturedRequest {
  params: URLSearchParams;
}

let capturedRequests: CapturedRequest[] = [];
// A plain object is returned as-is regardless of the requested page; a
// function receives the requested `page` (parsed from the query string) so
// a single test can simulate different pages returning different envelopes
// — needed for the out-of-range-page test below, which must return real
// rows for page 1 but an empty `attendees` array (with nonzero `total`) for
// the page actually requested.
let attendeesResponse: unknown | ((page: number) => unknown) = { attendees: [], total: 0, page: 1, per_page: 50 };
let attendeesStatus = 200;

const ADA = {
  id: "a1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "PD-0107",
  checkin_status: false,
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const BOB = {
  ...ADA,
  id: "a2",
  first_name: "Bob",
  last_name: "Noll",
  code: "PD-0108",
  checkin_status: true,
  printed_count: 2,
};

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/attendees", ({ request }) => {
    const url = new URL(request.url);
    capturedRequests.push({ params: url.searchParams });
    if (attendeesStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: attendeesStatus });
    }
    if (typeof attendeesResponse === "function") {
      const requestedPage = Number(url.searchParams.get("page") ?? "1");
      return HttpResponse.json(attendeesResponse(requestedPage));
    }
    return HttpResponse.json(attendeesResponse);
  }),
  http.get("http://api.test/api/events/:eventId/zones", () =>
    HttpResponse.json([
      {
        id: "z1",
        event_id: "evt-1",
        name: "Main Hall",
        zone_type: "general",
        order_index: 0,
        is_registration_zone: true,
        requires_registration: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]),
  ),
  // Task 8's drawer — fetched only when a row is clicked / the `attendee`
  // search param is set, but registered unconditionally here (matches
  // AddAttendeeDialog.test.tsx's convention of always-on handlers for
  // secondary requests a subset of tests trigger).
  http.get("http://api.test/api/attendees/:id", ({ params }) =>
    HttpResponse.json(params.id === "a1" ? ADA : BOB),
  ),
  http.get("http://api.test/api/attendees/:attendeeId/zone-access", () => HttpResponse.json([])),
  http.get("http://api.test/api/attendees/:attendeeId/zone-history", () => HttpResponse.json([])),
);
void server;

describe("AttendeesPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    capturedRequests = [];
    attendeesStatus = 200;
    attendeesResponse = { attendees: [ADA, BOB], total: 2, page: 1, per_page: 50 };
  });

  it("renders the table from the mocked envelope — names, codes, and the header total", async () => {
    renderAt("/events/evt-1/attendees");

    expect(await screen.findByText("2")).toBeInTheDocument(); // header total
    const table = within(screen.getByTestId("attendee-table"));
    expect(table.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(table.getByText("PD-0107")).toBeInTheDocument();
    expect(table.getByText("Bob Noll")).toBeInTheDocument();
    expect(table.getByText("PD-0108")).toBeInTheDocument();

    // Badge: printed_count 0 -> "Not printed", printed_count 2 -> "Printed".
    expect(table.getByText("Not printed")).toBeInTheDocument();
    expect(table.getByText("Printed")).toBeInTheDocument();

    // Status: checkin_status false -> "Not checked in", true -> "Checked in"
    // (icon + text + color per WCAG 1.4.1 — text assertion is the a11y-safe
    // check here since color alone would never satisfy it). Scoped to the
    // table, not `screen`, because the Status *filter* <select> also has
    // "Checked in"/"Not checked in" as literal option text.
    expect(table.getByText("Not checked in")).toBeInTheDocument();
    expect(table.getByText("Checked in")).toBeInTheDocument();

    expect(capturedRequests[0]?.params.get("page")).toBe("1");
    expect(capturedRequests[0]?.params.get("per_page")).toBe("50");
  });

  it("shows loading skeletons and never a fabricated total before the envelope arrives", async () => {
    renderAt("/events/evt-1/attendees");

    // The route match itself resolves asynchronously (a microtask beat,
    // even with no real async work) — wait for the first thing this page
    // renders unconditionally, then assert the loading-only state around it.
    expect(await screen.findByTestId("attendees-total-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attendees" })).toBeInTheDocument();
    expect(screen.getByTestId("attendees-table-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows an i18n'd error message with a retry affordance when the fetch fails", async () => {
    attendeesStatus = 500;
    renderAt("/events/evt-1/attendees");

    expect(await screen.findByText("Couldn't load attendees.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("debounces the search input into the `search` URL param and resets page to 1", async () => {
    const router = renderAt("/events/evt-1/attendees?page=3");
    await screen.findByText("Ada Lovelace");
    capturedRequests = [];

    const input = screen.getByPlaceholderText("Search name, email, code…");
    fireEvent.change(input, { target: { value: "ada" } });

    // No request fires immediately on keystroke.
    expect(capturedRequests).toHaveLength(0);

    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0), { timeout: 1000 });
    expect(capturedRequests[0]?.params.get("search")).toBe("ada");
    expect(capturedRequests[0]?.params.get("page")).toBe("1");
    expect(router.state.location.search.search).toBe("ada");
    expect(router.state.location.search.page).toBe(1);
  });

  it("sends the selected zone to the server and resets page to 1", async () => {
    const router = renderAt("/events/evt-1/attendees?page=2");
    await screen.findByText("Ada Lovelace");
    capturedRequests = [];

    await userEvent.click(screen.getByRole("combobox", { name: "Zone: All" }));
    await userEvent.click(await screen.findByRole("option", { name: "Main Hall" }));

    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));
    expect(capturedRequests[0]?.params.get("zone")).toBe("z1");
    expect(capturedRequests[0]?.params.get("page")).toBe("1");
    expect(router.state.location.search.zone).toBe("z1");
    expect(router.state.location.search.page).toBe(1);
  });

  it("sends the selected status to the server and resets page to 1", async () => {
    const router = renderAt("/events/evt-1/attendees?page=2");
    await screen.findByText("Ada Lovelace");
    capturedRequests = [];

    await userEvent.click(screen.getByRole("combobox", { name: "Status: Any" }));
    await userEvent.click(await screen.findByRole("option", { name: "Not checked in" }));

    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));
    expect(capturedRequests[0]?.params.get("status")).toBe("not_checked_in");
    expect(capturedRequests[0]?.params.get("page")).toBe("1");
    expect(router.state.location.search.status).toBe("not_checked_in");
    expect(router.state.location.search.page).toBe(1);
  });

  it("renders a 7-page pager with the expected ellipsis items and navigates on click", async () => {
    attendeesResponse = { attendees: [ADA], total: 331, page: 4, per_page: 50 };
    const router = renderAt("/events/evt-1/attendees?page=4");
    await screen.findByText("Ada Lovelace");

    // pageItems(4, 7) === [1, "…", 3, 4, 5, "…", 7] (verified directly in
    // pageItems.test.ts) — this asserts the same shape rendered as buttons.
    const nav = screen.getByRole("navigation", { name: "Attendees pagination" });
    expect(nav).toHaveTextContent("1…345…7");
    expect(screen.getByText("151–200 of 331")).toBeInTheDocument();

    const page5 = screen.getByRole("button", { name: "5" });
    expect(page5).not.toHaveAttribute("aria-current");
    const page4 = screen.getByRole("button", { name: "4" });
    expect(page4).toHaveAttribute("aria-current", "page");

    capturedRequests = [];
    fireEvent.click(page5);

    await waitFor(() => expect(router.state.location.search.page).toBe(5));
    expect(capturedRequests[0]?.params.get("page")).toBe("5");
  });

  it("shows the canonical empty state when there are no attendees and no active filters", async () => {
    attendeesResponse = { attendees: [], total: 0, page: 1, per_page: 50 };
    renderAt("/events/evt-1/attendees");

    expect(await screen.findByText("No attendees yet")).toBeInTheDocument();
    expect(
      screen.getByText("Import your guest list from a CSV, or add people one by one. Check-in can't open until someone is on the list."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No attendees match these filters.")).not.toBeInTheDocument();
  });

  it("shows a distinct 'no matches' state (not the canonical empty state) when filters are active and the result is empty, with a working clear-filters link", async () => {
    attendeesResponse = { attendees: [], total: 0, page: 1, per_page: 50 };
    const router = renderAt("/events/evt-1/attendees?search=zzz");

    expect(await screen.findByText("No attendees match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("No attendees yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(router.state.location.search.search).toBeUndefined());
    expect(router.state.location.search.page).toBe(1);
  });

  it("shows the bulk bar when a row is selected, and hides it again once selection clears", async () => {
    renderAt("/events/evt-1/attendees");
    await screen.findByText("Ada Lovelace");

    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();

    const table = within(screen.getByTestId("attendee-table"));
    fireEvent.click(table.getByLabelText("Select Ada Lovelace"));

    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(screen.queryByText("1 selected")).not.toBeInTheDocument());
  });

  it("opens the attendee drawer (sets ?attendee=) when a row is clicked, and closes it (clearing only that param) via the drawer's close affordance", async () => {
    const router = renderAt("/events/evt-1/attendees?page=2&search=ada");
    await screen.findByText("Ada Lovelace");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const table = within(screen.getByTestId("attendee-table"));
    fireEvent.click(table.getByText("Ada Lovelace"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search.attendee).toBe("a1"));
    // Row click must not disturb the page/search params already in the URL.
    expect(router.state.location.search.page).toBe(2);
    expect(router.state.location.search.search).toBe("ada");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.search.attendee).toBeUndefined();
    expect(router.state.location.search.page).toBe(2);
    expect(router.state.location.search.search).toBe("ada");
  });

  it("renders the drawer on a fresh mount when ?attendee=<id> is already in the URL (deep link, not a simulated click)", async () => {
    renderAt("/events/evt-1/attendees?attendee=a2");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await within(screen.getByRole("dialog")).findByText("Bob Noll")).toBeInTheDocument();
  });

  // Reproduces the finding: deleting the last row(s) on a non-first page
  // (via either BulkBar's bulk delete or AttendeeDrawer's single delete)
  // invalidates and refetches the list without resetting `page`, so the
  // backend correctly returns `{attendees: [], total: N}` for a page that's
  // now past the end. Seeding a page-aware fixture (page 3 empty — the
  // stale "just deleted the last row here" page — page 2 has the real
  // rows, both reporting total: 12 across a 2-page, per_page: 6 list)
  // reproduces exactly that server response shape without having to drive
  // a full delete flow. `total: 12` / `per_page: 6` (rather than something
  // that collides with a rendered pager page-number button, e.g. 1 or 2)
  // keeps the header-total assertions below unambiguous.
  it("auto-clamps an out-of-range page (empty rows, nonzero total) back to the last valid page instead of showing the canonical empty state", async () => {
    attendeesResponse = (page: number) =>
      page === 2
        ? { attendees: [ADA, BOB], total: 12, page: 2, per_page: 6 }
        : { attendees: [], total: 12, page, per_page: 6 };
    const router = renderAt("/events/evt-1/attendees?page=3");
    // Let the page-3 (out-of-range) request land before asserting on it —
    // otherwise the clamp effect's navigate can win the race and this
    // assertion would only ever observe the already-clamped page-2 state,
    // which wouldn't prove the header total was correct *before* the clamp.
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));

    // The header total reflects the real nonzero count as soon as the
    // (out-of-range) page-3 envelope lands — before the clamp navigation
    // has even happened — and never regresses to a stale/blank value.
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.queryByText("No attendees yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No attendees match these filters.")).not.toBeInTheDocument();

    // The page effect clamps `page` back to the true last page
    // (ceil(12 / 6) = 2) and the real rows render there.
    await waitFor(() => expect(router.state.location.search.page).toBe(2));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // header total, still correct post-clamp
    expect(screen.queryByText("No attendees yet")).not.toBeInTheDocument();
  });

  // Related Minor finding: an invalid `page` (non-positive or non-integer)
  // must never reach the server as-is — the backend 400s it, which without
  // the searchParams.ts clamp surfaces as the generic load-error box
  // instead of gracefully falling back to page 1.
  it.each([["?page=0", 0], ["?page=-1", -1], ["?page=1.5", 1.5]])(
    "treats an invalid page param (%s) as page 1 — never sends it to the server, never shows the load-error box",
    async (_label, _rawValue) => {
      renderAt(`/events/evt-1/attendees${_label}`);

      expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
      expect(capturedRequests[0]?.params.get("page")).toBe("1");
      expect(screen.queryByText("Couldn't load attendees.")).not.toBeInTheDocument();
    },
  );
});
