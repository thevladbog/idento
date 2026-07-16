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
function renderPage(extra?: ReactNode) {
  const router = buildRouter();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {extra}
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton — same rationale as
          AttendeesPage.test.tsx / WorkspaceOverview.test.tsx. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
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

  it("re-seeds the editor from the new event's template when navigating to another event", async () => {
    const { router } = renderPage();

    const canvas = await screen.findByTestId("badge-pane-canvas");
    expect(canvas.textContent).toMatch(/90/); // evt-1's doc

    // The refetch guard above must be scoped to ONE event — switching to a
    // different event's editor re-seeds from that event's template rather
    // than showing evt-1's stale doc.
    await act(async () => {
      await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });

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

      // Someone else bumped the version meanwhile; the retry PUT should
      // succeed this time.
      templateResponse = { template: { width_mm: 90, height_mm: 55, dpi: 300, elements: [] }, version: 9 };
      putStatus = 200;

      await user.click(screen.getByRole("button", { name: "Overwrite" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Confirm overwrite" }));

      await waitFor(() => expect(putRequests).toHaveLength(2));
      // Re-derived via the GET refetch (ApiError doesn't retain the 409
      // body's current_version — see BadgeEditorPage.tsx's comment), not
      // the stale local `state.version`.
      expect(putRequests[1].body.version).toBe(9);
      // The LOCAL edit (the added element) is what gets persisted, not the
      // server's `[]` — Overwrite means "my version wins".
      expect(putRequests[1].body.template.elements).toHaveLength(1);

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(
        screen.queryByText("Template changed on the server — review before overwriting."),
      ).not.toBeInTheDocument();
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

  it("resets the inline save error when navigating to another event", async () => {
    putStatus = 500;
    const user = userEvent.setup();
    const { router } = renderPage();

    await screen.findByTestId("badge-pane-elements");
    await addTextElement(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn't save the badge template. Try again.")).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });
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

    await act(async () => {
      await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });
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
    await act(async () => {
      await router.navigate({ to: "/events/$eventId/badge", params: { eventId: "evt-2" } });
    });

    // Immediately after navigating (before evt-2's template resolves),
    // `state.dirty` still carries evt-1's stale `true` — Save must stay
    // disabled anyway, or a click here would PUT evt-1's doc to evt-2's
    // path (Task 6/10 handoff: the `initialized` gate).
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
