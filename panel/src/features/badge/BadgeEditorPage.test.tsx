import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
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

// Mirrors AttendeesPage.test.tsx / WorkspaceOverview.test.tsx's harness shape:
// a throwaway route tree whose id/path structure matches the real app
// closely enough for `getRouteApi("/_app/events/$eventId/badge").useParams()`
// to resolve, without reconstructing EventWorkspaceLayout's own rail/header
// (that's EventWorkspaceLayout.test.tsx's job — this page fetches its own
// badge-template data, same as WorkspaceOverview does for readiness/stats).
function buildRouter() {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const badgeRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "/badge", component: BadgeEditorPage });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([badgeRoute])])]);
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
