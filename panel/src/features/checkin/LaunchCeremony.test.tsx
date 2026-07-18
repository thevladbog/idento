// P4.1 Task 11 -- LaunchCeremony tests.
//
// The FIRST describe block below is the routing proof this task's own
// brief asks for (reusing Task 8's StationPage.test.tsx technique rather
// than re-deriving it): app/router.tsx registers `eventCheckinLaunchRoute`
// as a TOP-LEVEL protected route, a SIBLING of `eventWorkspaceRoute` (both
// children of `protectedLayoutRoute`), so `/events/$eventId/checkin/launch`
// renders LaunchCeremony WITHOUT the workspace rail shell. Both
// registrations (sibling vs. "child of the workspace route with a relative
// path") resolve to the IDENTICAL final URL, so only the RENDERED OUTPUT
// (not the matched path string) can tell a correct sibling registration
// apart from an accidental nested one -- proven two ways: (1) a routed
// harness shaped exactly like app/router.tsx's real registration renders
// LaunchCeremony's content with none of the workspace shell's nav markers
// present, and (2) a deliberately-misregistered harness (the launch route
// nested as a CHILD of the workspace route) demonstrates the SAME assertion
// would fail if the registration were wrong.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { LaunchCeremony } from "./LaunchCeremony";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Distinguishing marker text for the workspace rail shell's own nav items
// (WorkspaceRail.tsx's real English copy) -- if the launch route were
// wrongly nested under the workspace route, these would render alongside
// LaunchCeremony's own content.
function WorkspaceShellStub() {
  return (
    <div>
      <nav>
        <span>Overview</span>
        <span>Attendees</span>
        <span>Zones</span>
        <span>Staff</span>
        <span>Badge</span>
      </nav>
      <Outlet />
    </div>
  );
}

// Mirrors app/router.tsx's REAL shape: an app-layout id route ("_app",
// standing in for protectedLayoutRoute) with the workspace route, the
// checkin (station) route, AND the checkin/launch route registered as
// SIBLING children -- exactly the registration this task adds.
function buildCorrectRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: WorkspaceShellStub,
  });
  const checkinRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId/checkin",
    validateSearch: (search: Record<string, unknown>) => ({ station: typeof search.station === "string" ? search.station : undefined }),
    component: () => <div>station stub</div>,
  });
  const launchRoute = createRoute({
    getParentRoute: () => appLayoutRoute, // sibling of workspaceRoute -- the fix under test.
    path: "/events/$eventId/checkin/launch",
    component: LaunchCeremony,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute, checkinRoute, launchRoute])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

// Reproduces the bug the sibling registration above avoids: the launch
// route nested as a CHILD of the workspace route (relative path
// "/checkin/launch") resolves to the exact same final URL but renders
// wrapped inside the workspace shell's own <Outlet/>.
function buildMisregisteredRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: WorkspaceShellStub,
  });
  const nestedLaunchRoute = createRoute({
    getParentRoute: () => workspaceRoute, // the mistake: a CHILD, not a sibling.
    path: "/checkin/launch",
    component: () => <div data-testid="dummy-launch-page">dummy</div>,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([nestedLaunchRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderWithRouter(router: ReturnType<typeof buildCorrectRouter> | ReturnType<typeof buildMisregisteredRouter>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton -- same rationale as
          StationPage.test.tsx / AttendeesPage.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

function renderCorrectAt(path: string) {
  return renderWithRouter(buildCorrectRouter(path));
}

const EVENT = {
  id: "evt-1",
  tenant_id: "t1",
  name: "Partner Day — Autumn",
  start_date: "2026-09-03T00:00:00.000Z",
  created_at: "",
  updated_at: "",
};

const ZONES = [
  {
    id: "zone-1",
    event_id: "evt-1",
    name: "Main Hall",
    zone_type: "general",
    order_index: 0,
    is_registration_zone: true,
    requires_registration: false,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

let readinessResponse: unknown = { ready: false, steps: [{ key: "attendees", status: "not_done" }] };
let settingsResponse: unknown = {
  print_on_checkin: true,
  verdict_auto_dismiss_sec: 4,
  scan_input: "wedge",
  manual_search_enabled: true,
};
let capturedSettingsPut: { settings: unknown } | null = null;
let capturedStationRegister: { name: string; zone_id: string | null } | null = null;
let registeredStationId = "st-new";

const server = startMswServer(
  http.get("http://api.test/api/events/:id", () => HttpResponse.json(EVENT)),
  http.get("http://api.test/api/events/:id/readiness", () => HttpResponse.json(readinessResponse)),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(ZONES)),
  http.get("http://api.test/api/events/:id/checkin-settings", () => HttpResponse.json({ settings: settingsResponse })),
  http.put("http://api.test/api/events/:id/checkin-settings", async ({ request }) => {
    const body = (await request.json()) as { settings: unknown };
    capturedSettingsPut = body;
    return HttpResponse.json({ settings: body.settings });
  }),
  http.post("http://api.test/api/events/:eventId/checkin-stations", async ({ request }) => {
    const body = (await request.json()) as { name: string; zone_id: string | null };
    capturedStationRegister = body;
    return HttpResponse.json({
      station: {
        id: registeredStationId,
        event_id: "evt-1",
        name: body.name,
        zone_id: body.zone_id,
        last_seen_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    });
  }),
  http.get("http://api.test/api/events/:id/badge-template", () => HttpResponse.json({ template: null, version: 0 })),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.get("http://api.test/api/events/:eventId/attendees", () =>
    HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 }),
  ),
  http.get("http://agent.test/health", () => new HttpResponse(null, { status: 200 })),
  http.get("http://agent.test/printers", () => HttpResponse.json([])),
  http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: null })),
);
void server;

describe("LaunchCeremony routing -- sibling registration proof", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    readinessResponse = { ready: false, steps: [{ key: "attendees", status: "not_done" }] };
  });

  it("renders LaunchCeremony's own content with NONE of the workspace shell's nav markers, when registered as a top-level sibling of the workspace route (app/router.tsx's real shape)", async () => {
    renderCorrectAt("/events/evt-1/checkin/launch");

    expect(await screen.findByTestId("launch-ceremony")).toBeInTheDocument();

    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendees")).not.toBeInTheDocument();
    expect(screen.queryByText("Zones")).not.toBeInTheDocument();
    expect(screen.queryByText("Staff")).not.toBeInTheDocument();
    expect(screen.queryByText("Badge")).not.toBeInTheDocument();
  });

  it("sanity check: the SAME workspace-shell-marker assertion WOULD fail if the launch route were (incorrectly) nested as a child of the workspace route -- proof the technique above actually discriminates", async () => {
    const router = buildMisregisteredRouter("/events/evt-1/checkin/launch");
    renderWithRouter(router);

    expect(await screen.findByTestId("dummy-launch-page")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Badge")).toBeInTheDocument();
  });
});

describe("LaunchCeremony", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    readinessResponse = { ready: false, steps: [{ key: "attendees", status: "not_done" }] };
    settingsResponse = {
      print_on_checkin: true,
      verdict_auto_dismiss_sec: 4,
      scan_input: "wedge",
      manual_search_enabled: true,
    };
    capturedSettingsPut = null;
    capturedStationRegister = null;
    registeredStationId = "st-new";
  });

  it("renders the 3-column ceremony: confirm event & station, check-in settings, printer check", async () => {
    renderCorrectAt("/events/evt-1/checkin/launch");

    await screen.findByTestId("launch-col-event");
    expect(screen.getByTestId("launch-col-settings")).toBeInTheDocument();
    expect(screen.getByTestId("launch-col-printer")).toBeInTheDocument();
    expect(screen.getByText("Confirm event & station")).toBeInTheDocument();
    expect(screen.getByText("Check-in settings")).toBeInTheDocument();
    expect(screen.getByText("Printer check")).toBeInTheDocument();
  });

  it("editing a setting and saving PUTs the whole settings object", async () => {
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");

    // Wait for the settings GET to seed the form (the switch starts checked
    // per settingsResponse's print_on_checkin: true).
    await waitFor(() => expect(screen.getByRole("switch", { name: "Print badge on check-in" })).toBeChecked());

    await user.click(screen.getByRole("switch", { name: "Print badge on check-in" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(capturedSettingsPut).not.toBeNull());
    expect(capturedSettingsPut).toEqual({
      settings: {
        print_on_checkin: false,
        verdict_auto_dismiss_sec: 4,
        scan_input: "wedge",
        manual_search_enabled: true,
      },
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  // PR #77 bot-review round, Finding N -- the SAME "ungated load effect" bug
  // class as P3.1's badge editor: `settingsForm`/`settingsBaseline` start as
  // the hardcoded DEFAULT_CHECKIN_SETTINGS until the real GET resolves.
  // Previously nothing stopped an operator from editing (and, since editing
  // makes the form diverge from a baseline that's STILL the hardcoded
  // default, saving) a whole-object PUT built on those defaults while the
  // real fetch was still in flight, clobbering the event's actual saved
  // settings the instant they'd otherwise have arrived.
  it("disables the settings form (and Save) until check-in settings have actually loaded, so a premature edit+save can't clobber real settings with defaults", async () => {
    server.use(
      http.get("http://api.test/api/events/:id/checkin-settings", async () => {
        await delay(50);
        return HttpResponse.json({ settings: settingsResponse });
      }),
    );
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-col-settings");

    expect(screen.getByRole("switch", { name: "Print badge on check-in" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Allow manual search" })).toBeDisabled();
    expect(screen.getByLabelText("Verdict auto-dismiss (seconds)")).toBeDisabled();
    expect(screen.getByLabelText("Scan input")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Print badge on check-in" })).toBeEnabled());
    expect(capturedSettingsPut).toBeNull();
  });

  it("disables the Start check-in CTA with an explanatory reason while the event isn't ready", async () => {
    readinessResponse = { ready: false, steps: [{ key: "attendees", status: "not_done" }] };
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");

    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeDisabled());
    expect(screen.getByText("Finish the badge and run a test print to unlock check-in.")).toBeInTheDocument();
  });

  it("enables the Start check-in CTA once the event is ready", async () => {
    readinessResponse = { ready: true, steps: [{ key: "attendees", status: "done", count: 10 }] };
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");

    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());
  });

  // PR #77 bot-review round 2, Finding 3 -- Start check-in navigates to the
  // station, which fetches the PERSISTED settings from the server -- an
  // unsaved edit (or a save still in flight) here must never be silently
  // discarded by that navigation.
  it("disables Start check-in while a settings edit is unsaved, with an explanatory hint, and re-enables it once the edit is saved", async () => {
    readinessResponse = { ready: true, steps: [{ key: "attendees", status: "done", count: 10 }] };
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());
    expect(screen.queryByTestId("launch-unsaved-settings-hint")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Print badge on check-in" }));

    expect(screen.getByRole("button", { name: "Start check-in" })).toBeDisabled();
    expect(screen.getByTestId("launch-unsaved-settings-hint")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());
    expect(screen.queryByTestId("launch-unsaved-settings-hint")).not.toBeInTheDocument();
  });

  it("keeps Start check-in disabled while a settings save is pending (in flight), even after the request resolves successfully", async () => {
    readinessResponse = { ready: true, steps: [{ key: "attendees", status: "done", count: 10 }] };
    server.use(
      http.put("http://api.test/api/events/:id/checkin-settings", async ({ request }) => {
        await delay(50);
        const body = (await request.json()) as { settings: unknown };
        capturedSettingsPut = body;
        return HttpResponse.json({ settings: body.settings });
      }),
    );
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());

    await user.click(screen.getByRole("switch", { name: "Print badge on check-in" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Start check-in" })).toBeDisabled();

    await waitFor(() => expect(capturedSettingsPut).not.toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());
  });

  it("Start check-in registers the station (upsert body {name, zone_id}) then navigates to the station with ?station=", async () => {
    readinessResponse = { ready: true, steps: [{ key: "attendees", status: "done", count: 10 }] };
    registeredStationId = "st-42";
    const user = userEvent.setup();
    const router = renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());

    const nameInput = screen.getByLabelText("Station name");
    await user.clear(nameInput);
    await user.type(nameInput, "Main Door");
    await user.selectOptions(screen.getByLabelText("Zone (optional)"), "Main Hall");

    await user.click(screen.getByRole("button", { name: "Start check-in" }));

    await waitFor(() => expect(capturedStationRegister).toEqual({ name: "Main Door", zone_id: "zone-1" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/events/evt-1/checkin"));
    expect(router.state.location.search).toEqual({ station: "st-42" });
    expect(await screen.findByText("station stub")).toBeInTheDocument();
  });

  it("disables Test badge with an explanatory hint when the event has no saved badge template yet", async () => {
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");

    await waitFor(() => expect(screen.getByRole("button", { name: "Test badge" })).toBeDisabled());
    expect(screen.getByText("Design a badge template first to test print it.")).toBeInTheDocument();
  });

  it("Test badge opens the reused P3.2 test-print dialog once a template exists and the agent is connected", async () => {
    server.use(
      http.get("http://api.test/api/events/:id/badge-template", () =>
        HttpResponse.json({ template: { width_mm: 50, height_mm: 30, dpi: 203, elements: [] }, version: 1 }),
      ),
      http.get("http://agent.test/printers", () => HttpResponse.json([{ name: "Zebra 1", type: "system" }])),
      http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: "Zebra 1" })),
    );
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");

    await waitFor(() => expect(screen.getByRole("button", { name: "Test badge" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Test badge" }));

    expect(await screen.findByText("Printing a test badge for Sample data")).toBeInTheDocument();
  });

  // PR #77 bot-review round 2, Finding 4 -- for an event whose saved badge
  // template came from the LEGACY path (no width_mm/height_mm/dpi ever set),
  // the REAL check-in/reprint print path (usePrintBadge.printAttendee)
  // deliberately falls back to the backend's own 50x30mm @ 203dpi (P3.2's
  // established backend-parity fallback), NOT parseTemplateDoc's editor
  // default (90x55mm @ 300dpi). "Test badge" must validate the SAME
  // resolution, or the test can pass while production output uses a
  // different label size/DPI. jsdom has neither FontFace nor document.fonts,
  // so this stubs both (same minimal mock every OTHER print-generation test
  // in this codebase uses) to let TestPrintDialog's own font-readiness gate
  // reach a terminal state and actually generate/send.
  describe("Test badge config resolution for a configless legacy template", () => {
    class MockFontFace {
      constructor(_family: string, _source: unknown, _descriptors?: { weight?: string; style?: string }) {}
      load(): Promise<MockFontFace> {
        return Promise.resolve(this);
      }
    }

    beforeEach(() => {
      (globalThis as unknown as { FontFace: unknown }).FontFace = MockFontFace;
      Object.defineProperty(document, "fonts", { value: { add: () => {} }, configurable: true, writable: true });
    });

    afterEach(() => {
      delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
      // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts`
      // stub; real jsdom has no `fonts` property to restore.
      delete document.fonts;
    });

    it("uses the backend's 50x30mm @ 203dpi fallback (^PW400/^LL240), not the editor's 90x55mm @ 300dpi default (^PW1063/^LL650), for a configless legacy template", async () => {
      let printedZpl: string | null = null;
      server.use(
        http.get("http://api.test/api/events/:id/badge-template", () =>
          // Configless legacy shape -- a real saved template with no
          // width_mm/height_mm/dpi keys at all, exactly what P3.1 predates.
          HttpResponse.json({ template: { elements: [] }, version: 1 }),
        ),
        http.get("http://agent.test/printers", () => HttpResponse.json([{ name: "Zebra 1", type: "system" }])),
        http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: "Zebra 1" })),
        http.post("http://agent.test/print", async ({ request }) => {
          const body = (await request.json()) as { printer_name: string; zpl: string };
          printedZpl = body.zpl;
          return HttpResponse.json({ status: "printed" });
        }),
      );
      const user = userEvent.setup();
      renderCorrectAt("/events/evt-1/checkin/launch");
      await screen.findByTestId("launch-ceremony");

      await waitFor(() => expect(screen.getByRole("button", { name: "Test badge" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "Test badge" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Print test badge" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "Print test badge" }));

      await waitFor(() => expect(printedZpl).not.toBeNull());
      expect(printedZpl).toContain("^PW400");
      expect(printedZpl).toContain("^LL240");
      expect(printedZpl).not.toContain("^PW1063");
      expect(printedZpl).not.toContain("^LL650");
    });

    it("uses the template's own explicit width_mm/height_mm/dpi (^PW1063/^LL650) when it's a modern, explicitly-configured template (no regression)", async () => {
      let printedZpl: string | null = null;
      server.use(
        http.get("http://api.test/api/events/:id/badge-template", () =>
          HttpResponse.json({ template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 1 }),
        ),
        http.get("http://agent.test/printers", () => HttpResponse.json([{ name: "Zebra 1", type: "system" }])),
        http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: "Zebra 1" })),
        http.post("http://agent.test/print", async ({ request }) => {
          const body = (await request.json()) as { printer_name: string; zpl: string };
          printedZpl = body.zpl;
          return HttpResponse.json({ status: "printed" });
        }),
      );
      const user = userEvent.setup();
      renderCorrectAt("/events/evt-1/checkin/launch");
      await screen.findByTestId("launch-ceremony");

      await waitFor(() => expect(screen.getByRole("button", { name: "Test badge" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "Test badge" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Print test badge" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "Print test badge" }));

      await waitFor(() => expect(printedZpl).not.toBeNull());
      expect(printedZpl).toContain("^PW1063");
      expect(printedZpl).toContain("^LL650");
    });
  });

  it("sends a null zone_id when no zone is picked", async () => {
    readinessResponse = { ready: true, steps: [{ key: "attendees", status: "done", count: 10 }] };
    const user = userEvent.setup();
    renderCorrectAt("/events/evt-1/checkin/launch");
    await screen.findByTestId("launch-ceremony");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start check-in" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Start check-in" }));

    await waitFor(() => expect(capturedStationRegister?.zone_id).toBeNull());
  });
});
