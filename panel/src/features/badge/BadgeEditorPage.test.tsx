import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import type { UseBlockerOpts } from "@tanstack/react-router";
import {
  act, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { BadgeEditorPage } from "./BadgeEditorPage";
import { useEventReadiness } from "../events/hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Task 11's dirty guard wires `useBlocker`'s `enableBeforeUnload` option as a
// function of `state.dirty`. There's no way to observe what closure a
// component passed into a hook from outside except intercepting the call, so
// this is a DELEGATING wrapper: every call still runs the REAL `useBlocker`
// (`actual.useBlocker`), so every OTHER test below exercises the real
// router's own blocking behavior, completely unchanged — it merely records
// the last-seen options for the ONE "enableBeforeUnload" test further down
// that reads `lastBlockerOptions` directly. No other test reads it.
let lastBlockerOptions: UseBlockerOpts | undefined;
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useBlocker: (opts: UseBlockerOpts) => {
      lastBlockerOptions = opts;
      return actual.useBlocker(opts as never);
    },
  };
});

// Mirrors AttendeesPage.test.tsx / WorkspaceOverview.test.tsx's harness shape:
// a throwaway route tree whose id/path structure matches the real app
// closely enough for `getRouteApi("/_app/events/$eventId/badge").useParams()`
// to resolve, without reconstructing EventWorkspaceLayout's own rail/header
// (that's EventWorkspaceLayout.test.tsx's job — this page fetches its own
// badge-template data, same as WorkspaceOverview does for readiness/stats).
// The sibling `/attendees` route (Task 11) stands in for "another workspace
// tab" — the dirty-guard tests navigate to it directly via `router.navigate`,
// same as this file's existing cross-EVENT navigation tests do for `/badge`.
function buildRouter() {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const badgeRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/badge", component: BadgeEditorPage });
  const otherTabRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/attendees",
    component: () => <div data-testid="other-workspace-tab">Attendees placeholder</div>,
  });
  const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([workspaceRoute.addChildren([badgeRoute, otherTabRoute])]),
  ]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/events/evt-1/badge"] }) });
}

// `extra` mounts alongside the routed page, inside the SAME QueryClient —
// Task 10's save-model tests use it for a genuinely-subscribed
// ReadinessObserver (PR #70's pattern: an observable refetch, not just an
// asserted `invalidateQueries` call). The page's own `templateQuery` already
// serves as that same kind of subscribed observer for BADGE_TEMPLATE_KEY, so
// no separate observer component is needed for that key.
//
// `existingQueryClient` (Codex round Fix 3): pass a QueryClient from a PRIOR
// `renderPage()` call to simulate a real in-app "unmount this page, remount
// it later" navigation (e.g. leave the badge route, come back) that reuses
// the SAME cache — as opposed to the default fresh QueryClient every other
// caller gets, which cannot observe cache continuity across an unmount.
function renderPage(extra?: ReactNode, existingQueryClient?: QueryClient) {
  const router = buildRouter();
  const queryClient = existingQueryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      {extra}
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton — same rationale as
          AttendeesPage.test.tsx / WorkspaceOverview.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { router, queryClient, unmount: view.unmount };
}

function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

// Helper for Task 10's save-flow tests: makes the loaded doc dirty via a
// genuine UI interaction (same "+ Add" -> "Text" flow ElementsPane.test.tsx
// exercises directly), rather than reaching into the reducer.
async function addTextElement(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "+ Add" }));
  await user.click(screen.getByRole("menuitem", { name: "Text" }));
}

interface CapturedPut {
  eventId: string;
  body: { template: { elements: unknown[] } & Record<string, unknown>; version: number };
}

let templateResponse: unknown = { template: null, version: 0 };
let templateStatus = 200;
let fetchCount = 0;
let getDelayMs = 0;
let putRequests: CapturedPut[] = [];
let putStatus = 200;
let putDelayMs = 0;
let readinessHitCount = 0;

// Task 12's preview data: usePreviewAttendee fires this on every render of
// the page (not gated behind any user action), so every test in this file
// now exercises it whether or not it cares about preview behavior --
// default to a single-attendee envelope so pre-Task-12 tests above stay
// unaffected (Task 12's own describe block below overrides this per test).
const DEFAULT_ATTENDEES_RESPONSE = {
  attendees: [{
    id: "pv-1",
    event_id: "evt-1",
    first_name: "Default",
    last_name: "Attendee",
    email: "default@example.com",
    company: "Acme",
    position: "Engineer",
    code: "PD-0001",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }],
  total: 1,
  page: 1,
  per_page: 50,
};
let attendeesResponse: unknown = DEFAULT_ATTENDEES_RESPONSE;
let attendeesStatus = 200;
let attendeesRequests: URLSearchParams[] = [];

// evt-2 always serves a fixed, visibly-different template (100 × 60 mm @
// 203 dpi) so the cross-event navigation test below can tell the two
// events' docs apart; every other event id serves the mutable
// `templateResponse` fixture.
const EVT_2_RESPONSE = {
  template: { width_mm: 100, height_mm: 60, dpi: 203, elements: [] },
  version: 7,
};

const server = startMswServer(
  http.get("http://api.test/api/events/:id/badge-template", async ({ params }) => {
    fetchCount += 1;
    if (getDelayMs) await delay(getDelayMs);
    if (templateStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: templateStatus });
    }
    if (params.id === "evt-2") {
      return HttpResponse.json(EVT_2_RESPONSE);
    }
    return HttpResponse.json(templateResponse);
  }),
  // Task 10's save mutation. Echoes the request's `template` back verbatim
  // (mirroring the real backend's byte-for-byte persistence, task 2) with
  // `version` bumped by one on success, so tests can assert BOTH the exact
  // request body AND the response the reducer's "saved"/"load" dispatch
  // consumes.
  http.put("http://api.test/api/events/:id/badge-template", async ({ request, params }) => {
    const body = (await request.json()) as CapturedPut["body"];
    putRequests.push({ eventId: params.id as string, body });
    if (putDelayMs) await delay(putDelayMs);
    if (putStatus === 409) {
      return HttpResponse.json({ error: "conflict", current_version: body.version + 1 }, { status: 409 });
    }
    if (putStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: putStatus });
    }
    return HttpResponse.json({ template: body.template, version: body.version + 1 });
  }),
  // The workspace rail's readiness query — Task 10's save must invalidate
  // this alongside BADGE_TEMPLATE_KEY (badge readiness flips on template
  // content). Subscribed via ReadinessObserver in the save-flow tests below.
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessHitCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
  // Task 7's ElementsPane needs `field_schema` (bindings.ts's
  // bindingOptions) — stubbed here (this file only cares about page-level
  // assembly, not ElementsPane's own binding behavior, which
  // ElementsPane.test.tsx owns). Same fixed-shape convention as
  // EventSettingsPage.test.tsx's own /api/events/:id stub.
  http.get("http://api.test/api/events/:id", ({ params }) => HttpResponse.json({
    id: params.id,
    tenant_id: "t1",
    name: "Partner Day",
    field_schema: ["dietary"],
    created_at: "",
    updated_at: "",
  })),
  // P3.2 Task 4: PropertiesPane's font <select> + useFontCoverage both need
  // this event's uploaded fonts list -- stubbed empty here (this file only
  // cares about page-level assembly/wiring, not the font selector's own
  // rendering, which PropertiesPane.test.tsx owns) so BadgeEditorPage's own
  // inline `$api.useQuery` for this endpoint (and useFontCoverage's
  // internal one, same query key, deduped by TanStack Query) both resolve
  // to `[]` without tripping this file's `onUnhandledRequest: "error"` MSW
  // server.
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  // Task 12's usePreviewAttendee -- fired unconditionally on every render
  // (both the unfiltered "default" query and the debounced-search query;
  // see that hook's own comment on why it's two calls). Captures every
  // request's query params (searchable via `attendeesRequests`) so the
  // "search types through to the hook" test below can assert the debounced
  // value actually reached the network request.
  http.get("http://api.test/api/events/:id/attendees", ({ request }) => {
    const url = new URL(request.url);
    attendeesRequests.push(url.searchParams);
    if (attendeesStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: attendeesStatus });
    }
    return HttpResponse.json(attendeesResponse);
  }),
);
void server;

describe("BadgeEditorPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
    fetchCount = 0;
    getDelayMs = 0;
    putRequests = [];
    putStatus = 200;
    putDelayMs = 0;
    readinessHitCount = 0;
    attendeesResponse = DEFAULT_ATTENDEES_RESPONSE;
    attendeesStatus = 200;
    attendeesRequests = [];
  });

  it("renders the top bar title and the locked Test print / ZPL preview actions", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Badge editor" })).toBeInTheDocument();
    const testPrint = screen.getByRole("button", { name: /Test print/ });
    const zplPreview = screen.getByRole("button", { name: /ZPL preview/ });
    expect(testPrint).toBeDisabled();
    expect(zplPreview).toBeDisabled();
  });

  it("shows skeleton panes and no pane content while the template query is loading", async () => {
    renderPage();

    // Mirrors ZonesPage.test.tsx's "shows loading skeletons" test: this
    // harness's route is nested one level under the workspace route (not an
    // index route), so the very first render is `findBy` (route matching),
    // not a synchronous assertion.
    expect((await screen.findAllByTestId("badge-pane-skeleton")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("badge-pane-elements")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-pane-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-pane-properties")).not.toBeInTheDocument();
  });

  it("shows load-error copy (distinct from the empty-state copy) and a retry action when the template fetch fails", async () => {
    templateStatus = 500;
    renderPage();

    expect(await screen.findByText("Couldn't load the badge template.")).toBeInTheDocument();
    expect(screen.queryByText("Add your first element")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("falls back to the parseTemplateDoc(null) default doc and shows the empty-state guidance when the event has no template yet", async () => {
    templateResponse = { template: null, version: 0 };
    renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(screen.getByText("Add your first element")).toBeInTheDocument();
    // parseTemplateDoc(null)'s defaults (90 x 55mm @ 300 dpi) surface in the
    // empty-state body — proves the reducer was actually seeded from the
    // resolved query data, not left at some other placeholder value.
    expect(canvas.textContent).toMatch(/90/);
    expect(canvas.textContent).toMatch(/55/);
    expect(canvas.textContent).toMatch(/300/);
  });

  it("renders the elements and properties pane placeholders once the template query resolves", async () => {
    renderPage();

    expect(await screen.findByTestId("badge-pane-elements")).toBeInTheDocument();
    expect(screen.getByTestId("badge-pane-properties")).toBeInTheDocument();
  });

  it("does not re-dispatch load over the editor's state when a background refetch returns changed data", async () => {
    templateResponse = { template: null, version: 0 };
    const { queryClient } = renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(canvas.textContent).toMatch(/90/); // parseTemplateDoc(null) defaults loaded

    // Another operator saved meanwhile: a background refetch (window
    // refocus, or a BADGE_TEMPLATE_KEY invalidation) now returns a
    // different template. The page must NOT re-dispatch "load" — that
    // would clobber the operator's in-progress editor state (doc, dirty,
    // selectedId) mid-session. The loaded baseline only ever changes via
    // an explicit reload path (Task 10's conflict handling).
    templateResponse = EVT_2_RESPONSE;
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await waitFor(() => expect(fetchCount).toBe(2));
    // Let any (buggy) re-load dispatch flush before the negative assertion.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    const canvasAfter = screen.getByTestId("badge-pane-canvas");
    expect(canvasAfter.textContent).toMatch(/90/);
    expect(canvasAfter.textContent).not.toMatch(/100/);
  });

  it("re-seeds the editor from the new event's template when navigating to another event (clean doc)", async () => {
    const { router } = renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(canvas.textContent).toMatch(/90/); // evt-1's doc

    // The refetch guard above must be scoped to ONE event — switching to a
    // different event's editor re-seeds from that event's template rather
    // than showing evt-1's stale doc. Doc is clean here, so the dirty guard
    // (below) never engages and the navigation passes straight through.
    await act(async () => {
      await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });

    await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));
    expect(screen.getByTestId("badge-pane-canvas").textContent).not.toMatch(/90/);
  });

  // Final-review Important 2: `shouldBlockFn` used to compare `fullPath` --
  // the route PATTERN ("/events/$eventId/badge"), not the resolved path --
  // so switching from evt-1's badge editor to evt-2's own (same pattern,
  // different `$eventId`) fell through the guard entirely while dirty,
  // silently discarding in-progress edits. The fix compares `pathname` (the
  // RESOLVED path) instead: "/events/evt-1/badge" -> "/events/evt-2/badge"
  // genuinely differs, so this must now be guarded exactly like navigating
  // to another workspace tab is (see the "dirty guard (Task 11)" describe
  // block below) -- while a hypothetical same-event, search-param-only
  // change (Task 12's `?attendee=` switcher) would keep the SAME pathname
  // and stay exempt, per BadgeEditorPage.tsx's own `shouldBlockFn` comment.
  it("blocks a cross-event badge->badge navigation while dirty; Discard proceeds and the new event's template then re-seeds the editor", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(canvas.textContent).toMatch(/90/); // evt-1's doc
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Unsaved changes")).toBeInTheDocument();
    // Still evt-1's doc -- the blocked navigation hasn't proceeded yet.
    expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/90/);

    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Same refetch-guard scoping as the clean-doc test above: once the
    // (previously blocked) navigation proceeds, the editor re-seeds from
    // evt-2's own template rather than showing evt-1's stale doc.
    await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));
    expect(screen.getByTestId("badge-pane-canvas").textContent).not.toMatch(/90/);
  });

  it("mounts the real BadgeCanvas artboard (not the empty-state guidance) once the template already has elements", async () => {
    templateResponse = {
      template: {
        width_mm: 90,
        height_mm: 55,
        dpi: 300,
        elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "{first_name}" }],
      },
      version: 2,
    };
    renderPage();

    await screen.findByTestId("badge-pane-canvas");
    expect(screen.queryByText("Add your first element")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-canvas-artboard")).toBeInTheDocument();
    expect(screen.getByTestId("badge-canvas-element-el-1")).toBeInTheDocument();
  });

  it("wires BadgeCanvas selection into the shared reducer, in sync with ElementsPane", async () => {
    templateResponse = {
      template: {
        width_mm: 90,
        height_mm: 55,
        dpi: 300,
        elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "Hi" }],
      },
      version: 2,
    };
    renderPage();

    const canvasElement = await screen.findByTestId("badge-canvas-element-el-1");
    fireEvent.click(canvasElement);

    // Same selection state now shown on the ElementsPane row (aria-current)
    // -- proves the page wires BOTH panes to the SAME `state.selectedId`,
    // not two independently-tracked selections. Scoped to the elements
    // pane: the canvas element ALSO renders the literal text "Hi".
    const elementsPane = screen.getByTestId("badge-pane-elements");
    const row = within(elementsPane).getByText("Hi").closest("button");
    expect(row).toHaveAttribute("aria-current", "true");
  });
});

// Task 10: the save model — pill states, the PUT itself, and the conflict
// banner's Reload/Overwrite resolutions. Owns the save-flow tests per this
// task's brief.
describe("BadgeEditorPage save model (Task 10)", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
    fetchCount = 0;
    getDelayMs = 0;
    putRequests = [];
    putStatus = 200;
    putDelayMs = 0;
    readinessHitCount = 0;
    attendeesResponse = DEFAULT_ATTENDEES_RESPONSE;
    attendeesStatus = 200;
    attendeesRequests = [];
  });

  it("shows no pill for a freshly-loaded template, and disables Save (not dirty yet)", async () => {
    renderPage();

    await screen.findByTestId("badge-pane-elements");
    expect(screen.queryByTestId("badge-save-state-pill")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it(
    "PUTs {template, version} (an untouched customFont extra survives verbatim), flips the pill to " +
      "Saved, and invalidates both the badge-template and readiness queries",
    async () => {
      templateResponse = {
        template: {
          width_mm: 90,
          height_mm: 55,
          dpi: 300,
          elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "Hi", customFont: "Roboto-Bold.ttf" }],
        },
        version: 5,
      };
      const user = userEvent.setup();
      renderPage(<ReadinessObserver eventId="evt-1" />);
      await waitFor(() => expect(readinessHitCount).toBe(1));

      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user);
      const saveButton = screen.getByRole("button", { name: "Save" });
      expect(saveButton).not.toBeDisabled();

      const fetchCountBeforeSave = fetchCount;
      await user.click(saveButton);

      await waitFor(() => expect(putRequests).toHaveLength(1));
      const { eventId, body } = putRequests[0];
      expect(eventId).toBe("evt-1");
      expect(body.version).toBe(5); // the version the doc was loaded with
      expect(body.template.elements).toHaveLength(2);
      // The pre-existing element's untouched `customFont` extra (unknown to
      // BadgeElement/parseTemplateDoc) survives the load -> edit -> save
      // round trip verbatim — serializeTemplateDoc's per-element merge onto
      // originalRawRef, not a re-derivation from the typed doc.
      expect(body.template.elements[0]).toEqual({
        id: "el-1", type: "text", x: 5, y: 5, text: "Hi", customFont: "Roboto-Bold.ttf",
      });

      const pill = await screen.findByTestId("badge-save-state-pill");
      expect(pill).toHaveAttribute("data-state", "saved");
      expect(pill.textContent).toMatch(/^Saved/);

      // BADGE_TEMPLATE_KEY(eventId) — this page's OWN templateQuery is
      // itself a subscribed observer of that key, so a genuine refetch
      // bumps the SAME fetchCount the loading tests above use.
      await waitFor(() => expect(fetchCount).toBeGreaterThan(fetchCountBeforeSave));
      // READINESS_KEY(eventId) — via the mounted ReadinessObserver (PR #70
      // pattern): an OBSERVABLE refetch, not just an asserted invalidate call.
      await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
    },
  );

  it("returns to the Unsaved pill when editing again after a successful save", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "saved"));

    await addTextElement(user);

    expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "dirty");
  });

  it("shows Saving and disables Save while the PUT is pending, then Saved once it resolves", async () => {
    putDelayMs = 60;
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "saving"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "saved"));
  });

  it("shows the Conflict pill and the conflict banner on a 409, and keeps Save disabled", async () => {
    putStatus = 409;
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "conflict");
    expect(
      screen.getByText("Template changed on the server — review before overwriting."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload server version" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overwrite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a non-409 failure shows the inline save-error line, keeps dirty, and returns the pill to Unsaved", async () => {
    putStatus = 500;
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Couldn't save the badge template. Try again.")).toBeInTheDocument();
    const pill = await screen.findByTestId("badge-save-state-pill");
    expect(pill).toHaveAttribute("data-state", "dirty");
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  describe("conflict resolution", () => {
    async function triggerConflict(user: ReturnType<typeof userEvent.setup>) {
      templateResponse = { template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 5 };
      putStatus = 409;
      renderPage();
      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "conflict");
    }

    it("Reload: confirming replaces the doc with the refetched version and clears the conflict to a clean pill", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);

      // Someone else's save landed meanwhile — the next GET returns THEIR
      // version, distinctly shaped so the test can tell the docs apart.
      templateResponse = {
        template: { width_mm: 100, height_mm: 60, dpi: 203, elements: [] },
        version: 6,
      };

      await user.click(screen.getByRole("button", { name: "Reload server version" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Reload" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(
        screen.queryByText("Template changed on the server — review before overwriting."),
      ).not.toBeInTheDocument();
      // Clean: no pill at all (savedAt reset by the "load" dispatch, not
      // dirty) — the brief's "pill Saved-state cleared to clean".
      expect(screen.queryByTestId("badge-save-state-pill")).not.toBeInTheDocument();
      expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/);
      // Only the original save attempt PUT — Reload never re-PUTs.
      expect(putRequests).toHaveLength(1);
    });

    it("Overwrite: confirming re-PUTs with the refetched current_version and the LOCAL edits, clearing the conflict on success", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);
      expect(putRequests).toHaveLength(1);

      // Final-review Important 5: a PRIOR overwrite attempt that itself
      // failed with a non-409 leaves the page-level inline error line up
      // (handleOverwriteConfirm's onError branch sets `saveErrorVisible`
      // too, not just `overwriteFailed` -- see that test above). That line
      // must not survive a LATER, successful retry.
      templateResponse = { template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 9 };
      putStatus = 500;
      await user.click(screen.getByRole("button", { name: "Overwrite" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Confirm overwrite" }));
      expect(await within(dialog).findByText("Couldn't save the badge template. Try again.")).toBeInTheDocument();

      // Someone else bumped the version meanwhile; the retry PUT should
      // succeed this time.
      putStatus = 200;
      await user.click(within(dialog).getByRole("button", { name: "Confirm overwrite" }));

      await waitFor(() => expect(putRequests).toHaveLength(3));
      // Re-derived via the GET refetch (ApiError doesn't retain the 409
      // body's current_version — see BadgeEditorPage.tsx's comment), not
      // the stale local `state.version`.
      expect(putRequests[2].body.version).toBe(9);
      // The LOCAL edit (the added element) is what gets persisted, not the
      // server's `[]` — Overwrite means "my version wins".
      expect(putRequests[2].body.template.elements).toHaveLength(1);

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(
        screen.queryByText("Template changed on the server — review before overwriting."),
      ).not.toBeInTheDocument();
      // The stale inline error line from the earlier FAILED attempt must be
      // gone too, not just the conflict banner.
      expect(screen.queryByText("Couldn't save the badge template. Try again.")).not.toBeInTheDocument();
      const pill = await screen.findByTestId("badge-save-state-pill");
      expect(pill).toHaveAttribute("data-state", "saved");
    });

    it("Reload: a FAILED refetch keeps the conflict (banner, dialog, edited doc) and surfaces the error inside the dialog instead of loading the stale cached doc", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);

      // The reload-triggered GET now fails transiently. react-query RETAINS
      // the last-successful data (the stale v5 doc) on a failed refetch
      // (status flips to 'error' but `data` stays), so a naive
      // `!result.data` check would treat this failure as success and load
      // the STALE doc as if it were the server's current version.
      templateStatus = 500;

      await user.click(screen.getByRole("button", { name: "Reload server version" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Reload" }));

      // Minor 1: the failure reason is surfaced INSIDE the open dialog —
      // a page-level inline line would render behind the modal overlay.
      expect(await within(dialog).findByText("Couldn't load the badge template.")).toBeInTheDocument();

      // Still in conflict: dialog open, banner behind it, pill unchanged,
      // and the confirm button re-enabled for a retry.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByText("Template changed on the server — review before overwriting."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "conflict");
      expect(within(dialog).getByRole("button", { name: "Reload" })).not.toBeDisabled();

      // The edited doc was NOT replaced by the stale cached v5 (whose
      // elements are empty — loading it would clear the added element and
      // resurface the empty-state guidance), and the panes stay mounted
      // (the full-page load-error screen is only for a never-loaded editor).
      expect(screen.getByTestId("badge-pane-elements")).toBeInTheDocument();
      expect(screen.queryByText("Add your first element")).not.toBeInTheDocument();
      expect(screen.queryByText("Couldn't load the badge template.")).toBe(
        within(dialog).getByText("Couldn't load the badge template."),
      );
    });

    it("Overwrite: a non-409 failure surfaces the save error inside the open dialog and keeps the conflict", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);

      // The version refetch succeeds, but the retry PUT itself fails.
      templateResponse = { template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 9 };
      putStatus = 500;

      await user.click(screen.getByRole("button", { name: "Overwrite" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Confirm overwrite" }));

      expect(await within(dialog).findByText("Couldn't save the badge template. Try again.")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByText("Template changed on the server — review before overwriting."),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Confirm overwrite" })).not.toBeDisabled();
    });

    it("Cancel on the Reload confirm dialog keeps the banner and makes no extra request", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);
      const fetchCountBefore = fetchCount;

      await user.click(screen.getByRole("button", { name: "Reload server version" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(
        screen.getByText("Template changed on the server — review before overwriting."),
      ).toBeInTheDocument();
      expect(fetchCount).toBe(fetchCountBefore);
    });

    it("Cancel on the Overwrite confirm dialog keeps the banner and makes no extra PUT", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);
      expect(putRequests).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Overwrite" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(
        screen.getByText("Template changed on the server — review before overwriting."),
      ).toBeInTheDocument();
      expect(putRequests).toHaveLength(1);
    });

    it("keeps the Reload confirm's confirm button inert while the resolution is busy", async () => {
      const user = userEvent.setup();
      await triggerConflict(user);
      getDelayMs = 60; // slows the refetch handleReloadConfirm awaits

      await user.click(screen.getByRole("button", { name: "Reload server version" }));
      const dialog = await screen.findByRole("dialog");
      const confirmButton = within(dialog).getByRole("button", { name: "Reload" });
      await user.click(confirmButton);

      // While the refetch is in flight, the confirm button is disabled —
      // exhaustive busy-gating, not just the primary save mutation.
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Reload" })).toBeDisabled());

      // Let the delayed refetch resolve before the test ends, so no
      // pending state update bleeds into the next test.
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });

  // Final-review Important 2 ripple: these three tests navigate cross-event
  // while `state.dirty` is true (a failed save / an open conflict / a
  // just-dirtied doc never clears `dirty`), directly awaiting
  // `router.navigate` as if it always passed straight through. Under the
  // OLD `fullPath` (route-pattern) comparison it did, because the pattern
  // is the same ("/events/$eventId/badge") — the exact bug this fix closes.
  // Under the new `pathname` comparison this is correctly guarded, so each
  // test now navigates through a blocked `void router.navigate(...)` +
  // Discard, same as the dedicated cross-event guard test above, before
  // observing the post-navigation assertions the tests were already making.
  it("resets the inline save error when navigating to another event", async () => {
    putStatus = 500;
    const user = userEvent.setup();
    const { router } = renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn't save the badge template. Try again.")).toBeInTheDocument();

    act(() => {
      void router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));

    // evt-1's failure must not linger over evt-2's editor.
    expect(screen.queryByText("Couldn't save the badge template. Try again.")).not.toBeInTheDocument();
  });

  it("resets the conflict banner and pill when navigating to another event", async () => {
    putStatus = 409;
    const user = userEvent.setup();
    const { router } = renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "conflict");

    act(() => {
      void router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));

    // evt-1's conflict must not linger over evt-2's editor: no banner, and
    // no pill at all (evt-2 loaded clean — not dirty, never saved).
    expect(
      screen.queryByText("Template changed on the server — review before overwriting."),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-save-state-pill")).not.toBeInTheDocument();
  });

  it("keeps Save disabled during the window between navigating to a new event and that event's load finishing", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    // Slow down evt-2's GET so the navigation window is observable.
    getDelayMs = 60;
    act(() => {
      void router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Immediately after the (now-proceeding) navigation (before evt-2's
    // template resolves), `state.dirty` still carries evt-1's stale `true`
    // — Save must stay disabled anyway, or a click here would PUT evt-1's
    // doc to evt-2's path (Task 6/10 handoff: the `initialized` gate).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));
    // Once evt-2 has loaded, Save is still disabled — now simply because
    // the freshly-loaded doc isn't dirty.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

// Task 11: the dirty guard — useBlocker-driven navigation/tab-close blocking
// plus the page-level Escape listener, both routed through the SAME
// GuardDialog. Owns the guard-flow tests per this task's brief.
describe("BadgeEditorPage dirty guard (Task 11)", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
    fetchCount = 0;
    getDelayMs = 0;
    putRequests = [];
    putStatus = 200;
    putDelayMs = 0;
    readinessHitCount = 0;
    lastBlockerOptions = undefined;
    attendeesResponse = DEFAULT_ATTENDEES_RESPONSE;
    attendeesStatus = 200;
    attendeesRequests = [];
  });

  it("clean doc: navigating to another workspace tab passes straight through, no guard dialog", async () => {
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });

    await screen.findByTestId("other-workspace-tab");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dirty doc: navigating to another workspace tab opens the guard dialog; Keep editing keeps the route unchanged", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("badge-pane-elements")).toBeInTheDocument();
    expect(screen.queryByTestId("other-workspace-tab")).not.toBeInTheDocument();
    expect(putRequests).toHaveLength(0);
  });

  it("dirty doc: Discard changes proceeds with the navigation and fires no PUT", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    await screen.findByTestId("other-workspace-tab");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(putRequests).toHaveLength(0);
  });

  it("dirty doc: Save & leave PUTs, then proceeds with the navigation on success", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Save & leave" }));

    await waitFor(() => expect(putRequests).toHaveLength(1));
    await screen.findByTestId("other-workspace-tab");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("dirty doc: Save & leave with a 409 stays on the page behind the conflict banner, and never navigates", async () => {
    putStatus = 409;
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Save & leave" }));

    await waitFor(() => expect(putRequests).toHaveLength(1));
    // reset()'d, not proceed()'d: the resolver goes back to idle, so the
    // guard dialog itself closes — revealing Task 10's conflict banner
    // underneath, exactly like a cancelled Reload/Overwrite dialog does.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("other-workspace-tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-pane-elements")).toBeInTheDocument();
    expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "conflict");
    expect(
      screen.getByText("Template changed on the server — review before overwriting."),
    ).toBeInTheDocument();
  });

  it("busy-gates all three guard buttons while the Save & leave PUT is pending", async () => {
    putDelayMs = 60;
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save & leave" }));

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Save & leave" })).toBeDisabled();

    // Let the delayed PUT resolve so nothing bleeds into the next test.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // Final-review Important 3: `performSave` (the ONE save path both the
  // top-bar Save button and this dialog's own Save/Save & leave button call)
  // silently no-ops when `saveDisabled` is true -- and `saveDisabled`
  // includes an unresolved `conflict`. Previously the guard dialog's Save
  // button stayed enabled through that, so clicking it while a conflict
  // banner was already up (e.g. the operator tried to navigate away instead
  // of resolving it first) did nothing with no feedback at all. The button
  // must instead render disabled, same as the exhaustive busy-gating above.
  it("disables the guard's Save & leave button while a conflict is unresolved, instead of a silent no-op", async () => {
    putStatus = 409;
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "conflict");

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("button", { name: "Save & leave" })).toBeDisabled();
    // Discard/Keep are NOT part of this gate — only the Save action is
    // meaningless while a conflict sits unresolved underneath.
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).not.toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).not.toBeDisabled();
  });

  it("dismissing the dialog via Escape (not clicking a button) also maps to Keep editing — route unchanged, no PUT", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    await screen.findByRole("dialog");

    // Radix's own DismissableLayer (native `document` keydown listener, see
    // GuardDialog.tsx) closes the dialog here — NOT this page's own Escape
    // handler, which is a documented no-op while the guard is already open.
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("badge-pane-elements")).toBeInTheDocument();
    expect(screen.queryByTestId("other-workspace-tab")).not.toBeInTheDocument();
    expect(putRequests).toHaveLength(0);
  });

  it("busy-gates the Escape/overlay dismiss path too — the dialog does not close via Escape while the PUT is pending", async () => {
    putDelayMs = 60;
    const user = userEvent.setup();
    const { router } = renderPage();
    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);

    act(() => {
      void router.navigate({ to: "/events/$eventId/attendees", params: { eventId: "evt-1" } });
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save & leave" }));

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBe(dialog); // still open, busy-gated

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("wires enableBeforeUnload as a function of the doc's dirty state (scoped useBlocker mock)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("badge-pane-elements");

    expect(lastBlockerOptions?.enableBeforeUnload).toBeInstanceOf(Function);
    expect((lastBlockerOptions!.enableBeforeUnload as () => boolean)()).toBe(false);

    await addTextElement(user);

    await waitFor(() => expect((lastBlockerOptions!.enableBeforeUnload as () => boolean)()).toBe(true));
  });

  describe("Escape", () => {
    it("does nothing when the doc is clean", async () => {
      renderPage();
      const elementsPane = await screen.findByTestId("badge-pane-elements");

      fireEvent.keyDown(elementsPane, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("deselects instead of opening the guard when an element is selected on the canvas, then opens the guard on a second Escape once nothing is selected", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user); // "add" both adds AND selects the new element

      const artboard = await screen.findByTestId("badge-canvas-artboard");
      fireEvent.keyDown(artboard, { key: "Escape" }); // Task 8: swallowed, deselects
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.keyDown(artboard, { key: "Escape" }); // nothing selected now: bubbles to the page
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    // Final-review Important 4: Task 8's canvas contract (swallow Escape,
    // deselect-first) only fires when the keydown actually originates ON
    // the artboard. A selection can persist while focus moves elsewhere
    // (e.g. into a PropertiesPane input, or — as here — the elements pane),
    // and pressing Escape from there used to bypass the canvas's own
    // handler entirely and go straight to `handlePageKeyDown`, which
    // (before this fix) never checked `state.selectedId` at all — so it
    // popped the revert-guard dialog immediately instead of deselecting
    // first. `handlePageKeyDown` must apply the SAME deselect-first rule
    // regardless of where focus currently is.
    it("deselects on Escape even when focus is outside the canvas, then opens the guard on a second Escape once nothing is selected", async () => {
      const user = userEvent.setup();
      renderPage();
      const elementsPane = await screen.findByTestId("badge-pane-elements");
      await addTextElement(user); // adds AND selects the new element; doc is now dirty
      expect(screen.getByTestId("badge-pane-properties")).not.toHaveTextContent(
        "Select an element to edit its properties.",
      );

      // Focus/event origin is the ELEMENTS pane, not the canvas artboard.
      fireEvent.keyDown(elementsPane, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("badge-pane-properties")).toHaveTextContent(
        "Select an element to edit its properties.",
      );

      fireEvent.keyDown(elementsPane, { key: "Escape" }); // nothing selected now: opens the guard
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("opens the guard in revert mode when dirty and nothing is selected; Discard reverts the doc to the loaded baseline, clears dirty, and fires no PUT", async () => {
      templateResponse = {
        template: {
          width_mm: 90, height_mm: 55, dpi: 300, elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "Hi" }],
        },
        version: 5,
      };
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("badge-canvas-element-el-1");
      await addTextElement(user); // now 2 elements, dirty, new element selected

      const artboard = screen.getByTestId("badge-canvas-artboard");
      fireEvent.keyDown(artboard, { key: "Escape" }); // deselect
      fireEvent.keyDown(artboard, { key: "Escape" }); // open the guard, revert mode
      const dialog = await screen.findByRole("dialog");
      // Revert mode has nowhere to navigate: no "Save & leave" copy here.
      expect(within(dialog).queryByRole("button", { name: "Save & leave" })).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByTestId("badge-save-state-pill")).not.toBeInTheDocument(); // clean again
      expect(screen.getByTestId("badge-canvas-element-el-1")).toBeInTheDocument();
      // The added element is gone — reverted to the ONE originally-loaded element.
      expect(screen.getByTestId("badge-pane-canvas").textContent?.match(/Hi/g)).toHaveLength(1);
      expect(putRequests).toHaveLength(0);
    });

    it("Keep editing closes the revert-mode guard without touching the doc", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user);

      const artboard = screen.getByTestId("badge-canvas-artboard");
      fireEvent.keyDown(artboard, { key: "Escape" });
      fireEvent.keyDown(artboard, { key: "Escape" });
      const dialog = await screen.findByRole("dialog");

      await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "dirty");
      expect(putRequests).toHaveLength(0);
    });

    it("the third button reads Save (not Save & leave) in revert mode, and a successful PUT stays on the page", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user);

      const artboard = screen.getByTestId("badge-canvas-artboard");
      fireEvent.keyDown(artboard, { key: "Escape" });
      fireEvent.keyDown(artboard, { key: "Escape" });
      const dialog = await screen.findByRole("dialog");

      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(putRequests).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByTestId("badge-pane-elements")).toBeInTheDocument(); // stayed on the page
      const pill = await screen.findByTestId("badge-save-state-pill");
      expect(pill).toHaveAttribute("data-state", "saved");
    });
  });
});

// Task 12: the canvas's live preview data (usePreviewAttendee) + the
// top-bar PreviewPicker switcher. Owns the preview-flow tests per this
// task's brief: default-first-attendee, switching, debounced search,
// zero-attendees/list-error sample fallback, and the per-element
// missing-binding hint.
describe("BadgeEditorPage preview data (Task 12)", () => {
  const ZOE = {
    id: "pv-zoe",
    event_id: "evt-1",
    first_name: "Zoe",
    last_name: "Zephyr",
    email: "zoe@example.com",
    company: "Acme",
    position: "Engineer",
    code: "PD-0002",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    custom_fields: {} as Record<string, unknown>,
  };
  const MAX = {
    ...ZOE, id: "pv-max", first_name: "Max", last_name: "Muster", email: "max@example.com", code: "PD-0003",
  };

  function templateWithSourceElement(source: string, text = "fallback") {
    return {
      template: {
        width_mm: 90, height_mm: 55, dpi: 300, elements: [{ id: "el-1", type: "text", x: 5, y: 5, source, text }],
      },
      version: 1,
    };
  }

  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
    fetchCount = 0;
    getDelayMs = 0;
    putRequests = [];
    putStatus = 200;
    putDelayMs = 0;
    readinessHitCount = 0;
    attendeesResponse = { attendees: [ZOE, MAX], total: 2, page: 1, per_page: 50 };
    attendeesStatus = 200;
    attendeesRequests = [];
  });

  it("defaults to the first page-1 attendee: shows their name in the picker and resolves it on the canvas", async () => {
    templateResponse = templateWithSourceElement("first_name");
    renderPage();

    expect(await screen.findByRole("button", { name: "Zoe Zephyr" })).toBeInTheDocument();
    expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Zoe");
  });

  it("switching via the picker updates the canvas text", async () => {
    templateResponse = templateWithSourceElement("first_name");
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("button", { name: "Zoe Zephyr" });
    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    await user.click(screen.getByRole("menuitem", { name: "Max Muster" }));

    expect(await screen.findByRole("button", { name: "Max Muster" })).toBeInTheDocument();
    expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Max");
  });

  it("typing in the picker's search box feeds the debounced value into useAttendeesPage's `search` param", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("button", { name: "Zoe Zephyr" });
    attendeesRequests = [];
    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    const input = screen.getByRole("searchbox", { name: "Search attendees" });
    fireEvent.change(input, { target: { value: "max" } });

    // No request fires immediately on keystroke (still debouncing).
    expect(attendeesRequests.some((params) => params.get("search") === "max")).toBe(false);

    await waitFor(
      () => expect(attendeesRequests.some((params) => params.get("search") === "max")).toBe(true),
      { timeout: 1000 },
    );
  });

  it("zero attendees falls back to sample mode with the visible, labeled pill", async () => {
    templateResponse = templateWithSourceElement("first_name");
    attendeesResponse = { attendees: [], total: 0, page: 1, per_page: 50 };
    renderPage();

    // Preview mode is "sample" from the very first render (before the
    // attendees query even settles -- see usePreviewAttendee's "never
    // fabricate during the loading window" comment), so the pill/name alone
    // don't prove the canvas pane has finished loading too -- wait on the
    // canvas element specifically (only rendered once templateQuery
    // resolves) before asserting its text.
    expect(await screen.findByText("Sample data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Анна Петрова" })).toBeInTheDocument();
    expect(await screen.findByTestId("badge-canvas-element-el-1")).toHaveTextContent("Анна");
    // Not the error note -- this is a genuinely empty event, not a failure.
    expect(screen.queryByText("Couldn't load attendees — showing sample data.")).not.toBeInTheDocument();
  });

  it("a list fetch error also falls back to sample mode, but additionally shows the honesty note (error != silently-sample)", async () => {
    templateResponse = templateWithSourceElement("first_name");
    attendeesStatus = 500;
    renderPage();

    // Wait on the error note specifically (not just "Sample data", which is
    // ALSO shown during the transient pre-settle loading window, before the
    // 500 has actually landed) -- this only ever appears once the base
    // query has genuinely settled into its error state.
    expect(await screen.findByText("Couldn't load attendees — showing sample data.")).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Анна Петрова" })).toBeInTheDocument();
    expect(await screen.findByTestId("badge-canvas-element-el-1")).toHaveTextContent("Анна");
  });

  it("an element bound to a custom field missing on the previewed attendee renders empty and carries the missing-binding hint", async () => {
    // No static `text` fallback (ElementsPane's own default for a
    // source-bound text element is `text: ""`) -- confirms the render is
    // genuinely EMPTY, not silently substituting some other placeholder.
    templateResponse = templateWithSourceElement("dietary", ""); // ZOE's custom_fields has no "dietary" key
    renderPage();

    const el = await screen.findByTestId("badge-canvas-element-el-1");
    expect(el.textContent).toBe("");
    expect(el).toHaveAttribute("title", "Empty for this attendee — no invented value shown.");
  });

  // Review fix (Important): a picked attendee must never be rendered from
  // its frozen pick-time snapshot -- it's re-validated against the freshest
  // successful list data on every refetch. Fresh fields propagate; an id
  // verifiably gone from the roster drops the selection; an ERRORED refetch
  // retains the last-known-good preview (error != silently-clear, the same
  // honesty rule the sample fallback follows).
  describe("selected-attendee revalidation against fresh list data", () => {
    async function selectMax(user: ReturnType<typeof userEvent.setup>) {
      await screen.findByRole("button", { name: "Zoe Zephyr" });
      await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
      await user.click(screen.getByRole("menuitem", { name: "Max Muster" }));
      await screen.findByRole("button", { name: "Max Muster" });
    }

    it("renders the selected attendee from the FRESH refetched object -- another operator's field edits propagate", async () => {
      templateResponse = templateWithSourceElement("first_name");
      const user = userEvent.setup();
      const { queryClient } = renderPage();
      await selectMax(user);
      expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Max");

      // Another operator renames Max; any invalidation-driven refetch now
      // returns the updated row under the same id.
      attendeesResponse = {
        attendees: [ZOE, { ...MAX, first_name: "Maximilian" }], total: 2, page: 1, per_page: 50,
      };
      await act(async () => {
        await queryClient.invalidateQueries();
      });

      await waitFor(() => expect(screen.getByRole("button", { name: "Maximilian Muster" })).toBeInTheDocument());
      expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Maximilian");
    });

    it("drops a selection verifiably absent from a successful refetch, falling back to the first attendee", async () => {
      templateResponse = templateWithSourceElement("first_name");
      const user = userEvent.setup();
      const { queryClient } = renderPage();
      await selectMax(user);

      // Max was deleted; the refetched page-1 envelope provably covers the
      // whole roster (total === attendees.length), so his absence is a
      // verified fact, not a paging artifact.
      attendeesResponse = { attendees: [ZOE], total: 1, page: 1, per_page: 50 };
      await act(async () => {
        await queryClient.invalidateQueries();
      });

      await waitFor(() => expect(screen.getByRole("button", { name: "Zoe Zephyr" })).toBeInTheDocument());
      expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Zoe");
      expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    });

    it("drops a verifiably-gone selection to sample mode when the refetched roster is empty", async () => {
      templateResponse = templateWithSourceElement("first_name");
      const user = userEvent.setup();
      const { queryClient } = renderPage();
      await selectMax(user);

      attendeesResponse = { attendees: [], total: 0, page: 1, per_page: 50 };
      await act(async () => {
        await queryClient.invalidateQueries();
      });

      await waitFor(() => expect(screen.getByText("Sample data")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Анна Петрова" })).toBeInTheDocument();
      expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Анна");
      // A verified-empty roster is not a fetch failure -- no error note.
      expect(screen.queryByText("Couldn't load attendees — showing sample data.")).not.toBeInTheDocument();
    });

    it("retains the selected attendee (last-known-good) when the refetch itself errors", async () => {
      templateResponse = templateWithSourceElement("first_name");
      const user = userEvent.setup();
      const { queryClient } = renderPage();
      await selectMax(user);

      // The refetch fails: react-query retains the last-successful data
      // (status flips to 'error', data stays) -- nothing disproved the
      // selection, so it must NOT be cleared.
      attendeesStatus = 500;
      await act(async () => {
        await queryClient.invalidateQueries();
      });
      // Let the query's error-state notification flush before the negative
      // assertions: the observer update lands a tick AFTER invalidateQueries'
      // own promise resolves (verified empirically -- without this flush the
      // pre-fix code passed these assertions by accident, still showing the
      // last render). Same idiom as the "does not re-dispatch load" test.
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(screen.getByRole("button", { name: "Max Muster" })).toBeInTheDocument();
      expect(screen.getByTestId("badge-canvas-element-el-1")).toHaveTextContent("Max");
      // The `badgePreviewListError` copy claims sample data is showing --
      // it isn't (the retained real attendee is), so the note must stay
      // hidden rather than lie about what's on the canvas.
      expect(screen.queryByText("Couldn't load attendees — showing sample data.")).not.toBeInTheDocument();
    });
  });

  // Review Minor 1: a search typed to browse (but abandoned without a pick)
  // must not still filter the option list the next time the picker opens.
  it("clears the picker's search when it closes without a selection", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("button", { name: "Zoe Zephyr" });
    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    const input = screen.getByRole("searchbox", { name: "Search attendees" });
    fireEvent.change(input, { target: { value: "max" } });
    expect(input).toHaveValue("max");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    expect(screen.getByRole("searchbox", { name: "Search attendees" })).toHaveValue("");
  });

  // Context note: the picker's DropdownMenu is not a Dialog, so it isn't
  // covered by handlePageKeyDown's existing guardOpen/reloadDialogOpen/
  // overwriteDialogOpen checks -- without also gating on `previewPickerOpen`
  // (PreviewPicker.tsx's lifted-up `open` prop), the SAME Escape keystroke
  // that closes the picker would also bubble up (React's synthetic dispatch
  // walks the React tree across the portal in parallel with Radix's own
  // native `document` dismiss listener -- see handlePageKeyDown's own
  // comment) and incorrectly pop the dirty-changes guard too.
  it("pressing Escape to close the open PreviewPicker dropdown does not also open the dirty-changes guard", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user); // dirty
    expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "dirty");

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    // The dirty guard must NOT have opened for this same keystroke, and the
    // doc is still dirty exactly as it was before (Escape here closed only
    // the dropdown, nothing else).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "dirty");
  });
});

// Codex round: Fix 3 (seed the badge-template cache from the save's own
// response) and Fix 4 (a captured-eventId guard on the save's onSuccess/
// onError, so a save that settles AFTER a cross-event navigation can't act
// on the editor of whatever event is now showing).
describe("BadgeEditorPage save model — Codex round Fix 3/Fix 4", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    templateResponse = { template: null, version: 0 };
    templateStatus = 200;
    fetchCount = 0;
    getDelayMs = 0;
    putRequests = [];
    putStatus = 200;
    putDelayMs = 0;
    readinessHitCount = 0;
    attendeesResponse = DEFAULT_ATTENDEES_RESPONSE;
    attendeesStatus = 200;
    attendeesRequests = [];
  });

  it(
    "Fix 3: seeds the badge-template cache from the PUT's own response, so a remounted editor for the " +
      "same event doesn't wait on a slow post-save refetch",
    async () => {
      getDelayMs = 150; // holds back every GET, including the invalidation-triggered post-save refetch
      templateResponse = {
        template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [{ id: "el-1", type: "text", x: 5, y: 5, text: "Hi" }] },
        version: 3,
      };
      const user = userEvent.setup();
      const { unmount, queryClient } = renderPage();

      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user);
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(putRequests).toHaveLength(1));
      await waitFor(() => expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "saved"));

      // Leave the page (e.g. navigating away) BEFORE the invalidation's own
      // GET refetch -- held back by getDelayMs above -- has resolved.
      unmount();

      // Remount a FRESH editor instance for the SAME event, reusing the SAME
      // QueryClient (as a real in-app navigate-away-and-back would). Without
      // Fix 3's setQueryData seeding, this fresh mount's own
      // `useBadgeTemplate` query would still serve the STALE pre-save cache
      // entry (version 3, ONE element) synchronously on mount -- the slow
      // invalidated refetch hasn't resolved yet -- rather than the
      // just-saved version 4 with TWO elements.
      renderPage(undefined, queryClient);

      await screen.findByTestId("badge-pane-canvas");
      // Asserted immediately (no lenient waitFor) -- with the fix this is
      // already correct on mount, straight from the seeded cache entry; a
      // waitFor with its default ~1s timeout would eventually see the right
      // value regardless of the fix, once the slow refetch above resolves,
      // and so would not actually distinguish RED from GREEN.
      expect(screen.getAllByTestId(/^badge-canvas-element-/)).toHaveLength(2);
      // Save stays disabled: the fresh editor's own baseline already matches
      // what's actually stored server-side -- no false 409 on its next save.
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    },
  );

  it(
    "Fix 4: a save that settles after the operator has navigated to a different event's editor does not " +
      "corrupt that event's state, but its own cache invalidation still runs",
    async () => {
      putDelayMs = 60;
      const user = userEvent.setup();
      const { router, queryClient } = renderPage(<ReadinessObserver eventId="evt-1" />);
      await waitFor(() => expect(readinessHitCount).toBe(1));

      await screen.findByTestId("badge-pane-elements");
      await addTextElement(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      // isPending is now true (evt-1's PUT is held by putDelayMs) --
      // shouldBlockFn's own `!saveTemplate.isPending` check means this exact
      // navigation attempt passes straight through with NO guard dialog at
      // all: the same deliberate "let it through mid-save" exemption
      // BadgeEditorPage.tsx's shouldBlockFn comment documents, and precisely
      // the race Fix 4 covers -- evt-1's save is still in flight while the
      // operator moves to a different event entirely.
      await waitFor(() => expect(screen.getByTestId("badge-save-state-pill")).toHaveAttribute("data-state", "saving"));
      await act(async () => {
        await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // evt-2's own (unrelated, clean, never-saved) template is now showing.
      // Its OWN pill still legitimately reads "Saving…" for a moment here —
      // `saveTemplate.isPending` reflects the ONE shared mutation object
      // (evt-1's still-in-flight PUT), not a per-event flag, and that
      // display quirk is unrelated to what Fix 4 covers (the onSuccess/
      // onError SIDE EFFECTS) — so the assertion below waits for the PUT to
      // actually settle before checking the pill is gone.
      await waitFor(() => expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/));
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      // evt-1's PUT now settles, well after the navigation. Without the
      // captured-eventId guard, its onSuccess would dispatch "saved" and
      // overwrite `originalRawRef` against whatever the reducer holds NOW --
      // evt-2's freshly-loaded doc -- falsely flipping evt-2's pill to
      // "Saved" and corrupting evt-2's baseline, even though evt-2 was never
      // touched.
      await waitFor(() => expect(putRequests).toHaveLength(1));
      await waitFor(() => expect(putRequests[0].eventId).toBe("evt-1"));
      // Give the delayed PUT's settle-time callbacks a chance to run (and,
      // pre-fix, misfire) before the negative assertions below.
      await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

      expect(screen.getByTestId("badge-pane-canvas").textContent).toMatch(/100/);
      expect(screen.queryByTestId("badge-save-state-pill")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      // evt-1's OWN cache invalidation must still be unconditional and keyed
      // to the CAPTURED (evt-1) id -- Fix 4 only guards the CURRENT editor's
      // reaction, not the mutation's own cache bookkeeping. The mounted
      // ReadinessObserver for evt-1 is a genuinely-subscribed observer (PR
      // #70's pattern), so a real refetch bumps this count regardless of
      // which page is currently on screen.
      await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
      expect(queryClient.getQueryData(["get", "/api/events/{id}/badge-template", { params: { path: { id: "evt-1" } } }]))
        .toEqual({ template: putRequests[0].body.template, version: 1 });
    },
  );
});
