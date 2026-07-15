import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import {
  render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { ZonesPage } from "./ZonesPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Mirrors AttendeesPage.test.tsx's harness shape (throwaway route tree whose
// id/path structure matches the real app closely enough for
// `getRouteApi("/_app/events/$eventId/zones")` to resolve params).
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const zonesRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/zones",
    component: ZonesPage,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([zonesRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error — same rationale as AttendeesPage.test.tsx:
          this test router's route shape differs from the app's registered
          singleton. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

interface ZoneFixture {
  id: string;
  name: string;
  is_registration_zone?: boolean;
  is_active?: boolean;
  access_rules_count?: number;
  settings?: Record<string, unknown>;
}

function zoneWithStats(fixture: ZoneFixture) {
  return {
    zone: {
      id: fixture.id,
      event_id: "evt-1",
      name: fixture.name,
      zone_type: "general",
      order_index: 0,
      is_registration_zone: fixture.is_registration_zone ?? false,
      requires_registration: false,
      is_active: fixture.is_active ?? true,
      settings: fixture.settings,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    total_checkins: 0,
    today_checkins: 0,
    assigned_staff: 0,
    access_rules_count: fixture.access_rules_count ?? 0,
  };
}

let zonesResponse: unknown = [];
let zonesStatus = 200;
let createCount = 0;
let updateCount = 0;
let lastUpdateBody: unknown;
let deleteCount = 0;
let lastDeletedId: string | undefined;
let deleteStatusOverride: number | null = null;
let deleteDelayMs = 0;
let rulesResponses: Record<string, unknown[]> = {};
let rulesStatusOverride: Record<string, number> = {};
let putBodies: { zoneId: string; body: unknown }[] = [];
let putStatus = 200;
let putDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/zones/:zoneId/access-rules", ({ params }) => {
    const zoneId = params.zoneId as string;
    const statusOverride = rulesStatusOverride[zoneId];
    if (statusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: statusOverride });
    }
    return HttpResponse.json(rulesResponses[zoneId] ?? []);
  }),
  http.put("http://api.test/api/zones/:zoneId/access-rules", async ({ request, params }) => {
    const body = await request.json();
    putBodies.push({ zoneId: params.zoneId as string, body });
    if (putDelayMs) await delay(putDelayMs);
    if (putStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: putStatus });
    }
    return HttpResponse.json({ message: "updated" });
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => {
    if (zonesStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: zonesStatus });
    }
    return HttpResponse.json(zonesResponse);
  }),
  http.post("http://api.test/api/events/:eventId/zones", async ({ request }) => {
    createCount += 1;
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      {
        id: "z-new",
        event_id: "evt-1",
        name: body.name,
        zone_type: "general",
        order_index: 2,
        is_registration_zone: false,
        requires_registration: false,
        is_active: true,
        settings: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      { status: 201 },
    );
  }),
  http.put("http://api.test/api/zones/:id", async ({ request, params }) => {
    updateCount += 1;
    lastUpdateBody = await request.json();
    return HttpResponse.json({ id: params.id as string, event_id: "evt-1", ...(lastUpdateBody as object) });
  }),
  http.delete("http://api.test/api/zones/:id", async ({ params }) => {
    deleteCount += 1;
    lastDeletedId = params.id as string;
    if (deleteDelayMs) await delay(deleteDelayMs);
    if (deleteStatusOverride) {
      return HttpResponse.json({ error: "Zone is still referenced by attendees" }, { status: deleteStatusOverride });
    }
    return HttpResponse.json({ message: "deleted" });
  }),
);
void server;

describe("ZonesPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    zonesStatus = 200;
    zonesResponse = [
      zoneWithStats({ id: "z1", name: "Main Hall", is_registration_zone: true, access_rules_count: 0 }),
      zoneWithStats({ id: "z2", name: "VIP Lounge", access_rules_count: 2 }),
    ];
    createCount = 0;
    updateCount = 0;
    lastUpdateBody = undefined;
    deleteCount = 0;
    lastDeletedId = undefined;
    deleteStatusOverride = null;
    deleteDelayMs = 0;
    rulesResponses = {};
    rulesStatusOverride = {};
    putBodies = [];
    putStatus = 200;
    putDelayMs = 0;
  });

  it("renders the header (h2 + mono count) and the caption", async () => {
    renderAt("/events/evt-1/zones");

    expect(await screen.findByRole("heading", { name: "Zones" })).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByText("Optional — attendees always get the entrance zone.")).toBeInTheDocument();
  });

  it("shows the entrance subtitle only for the registration zone", async () => {
    renderAt("/events/evt-1/zones");

    await screen.findByText("Main Hall");
    expect(screen.getAllByText("Entrance zone")).toHaveLength(1);
  });

  it("shows 'All attendees' for a zone with no access rules and the by-rule copy (with the real rule count) for one with rules", async () => {
    renderAt("/events/evt-1/zones");

    await screen.findByText("Main Hall");
    expect(screen.getByText("All attendees")).toBeInTheDocument();
    expect(screen.getByText("By rule · 2")).toBeInTheDocument();
  });

  it("shows a muted 'Inactive' suffix only for zones with is_active === false, and never fabricates it for active zones", async () => {
    zonesResponse = [
      zoneWithStats({ id: "z1", name: "Main Hall", is_registration_zone: true }),
      zoneWithStats({ id: "z3", name: "Backstage", is_active: false }),
    ];
    renderAt("/events/evt-1/zones");

    await screen.findByText("Backstage");
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows loading skeletons and never a fabricated count before the zones arrive", async () => {
    renderAt("/events/evt-1/zones");

    expect(await screen.findByTestId("zones-list-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("zones-total-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Main Hall")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("shows an i18n'd error message, distinct from the empty state, when the fetch fails", async () => {
    zonesStatus = 500;
    renderAt("/events/evt-1/zones");

    expect(await screen.findByText("Couldn't load zones.")).toBeInTheDocument();
    expect(screen.queryByText("No zones yet")).not.toBeInTheDocument();
  });

  it("shows the canonical empty state when there are no zones", async () => {
    zonesResponse = [];
    renderAt("/events/evt-1/zones");

    expect(await screen.findByText("No zones yet")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load zones.")).not.toBeInTheDocument();
  });

  describe("create/edit/delete wiring", () => {
    it("the header '+ New zone' button opens the create dialog", async () => {
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      // With zones present, only the header button exists — no EmptyState.
      await user.click(screen.getByRole("button", { name: "+ New zone" }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "New zone" })).toBeInTheDocument();
    });

    it("shows '+ New zone' twice when the list is empty (header + EmptyState action), and both open the create dialog", async () => {
      zonesResponse = [];
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("No zones yet");

      const buttons = screen.getAllByRole("button", { name: "+ New zone" });
      expect(buttons).toHaveLength(2);

      await user.click(buttons[0]);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(buttons[1]);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("submitting the create dialog from the header button actually creates the zone", async () => {
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      await user.click(screen.getByRole("button", { name: "+ New zone" }));
      await user.type(await screen.findByLabelText("Name"), "Backstage");
      await user.click(screen.getByRole("button", { name: "Create zone" }));

      await waitFor(() => expect(createCount).toBe(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("submitting the edit dialog actually updates the zone", async () => {
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("VIP Lounge");

      await user.click(screen.getByRole("button", { name: "More actions for VIP Lounge" }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit zone" }));
      const nameInput = await screen.findByLabelText("Name");
      await user.clear(nameInput);
      await user.type(nameInput, "VIP Lounge (renamed)");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(updateCount).toBe(1));
      expect((lastUpdateBody as { name: string }).name).toBe("VIP Lounge (renamed)");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("row menu 'Edit zone' opens the edit dialog prefilled with that zone's name", async () => {
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("VIP Lounge");

      await user.click(screen.getByRole("button", { name: "More actions for VIP Lounge" }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit zone" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("heading", { name: "Edit zone" })).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Name")).toHaveValue("VIP Lounge");
    });

    it("row menu 'Delete zone…' opens a typed-confirm dialog gated on the zone's exact name, and a successful delete invalidates the list", async () => {
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("VIP Lounge");

      await user.click(screen.getByRole("button", { name: "More actions for VIP Lounge" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete zone…" }));

      const dialog = await screen.findByRole("dialog");
      const confirmButton = within(dialog).getByRole("button", { name: "Delete zone" });
      expect(confirmButton).toBeDisabled();

      const input = within(dialog).getByLabelText("Type VIP Lounge to confirm");
      await user.type(input, "VIP Lounge");
      expect(confirmButton).toBeEnabled();

      await user.click(confirmButton);

      await waitFor(() => expect(deleteCount).toBe(1));
      expect(lastDeletedId).toBe("z2");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("keeps the delete dialog open and shows the server error message on a 4xx/5xx failure", async () => {
      deleteStatusOverride = 409;
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("VIP Lounge");

      await user.click(screen.getByRole("button", { name: "More actions for VIP Lounge" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete zone…" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type VIP Lounge to confirm"), "VIP Lounge");
      await user.click(within(dialog).getByRole("button", { name: "Delete zone" }));

      await waitFor(() => expect(deleteCount).toBe(1));
      expect(await within(dialog).findByText("Zone is still referenced by attendees")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBe(dialog);
    });

    it("still invalidates the zones list, but does not surface an error, if the delete dialog is cancelled before a pending DELETE resolves", async () => {
      deleteDelayMs = 50;
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("VIP Lounge");

      await user.click(screen.getByRole("button", { name: "More actions for VIP Lounge" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete zone…" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type VIP Lounge to confirm"), "VIP Lounge");
      await user.click(within(dialog).getByRole("button", { name: "Delete zone" }));

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await waitFor(() => expect(deleteCount).toBe(1));
      // Give the delayed response time to land after the close — it must
      // not resurrect the dialog or an error.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("Zone is still referenced by attendees")).not.toBeInTheDocument();
    });
  });

  describe("access-rule builder wiring (Task 4)", () => {
    it("clicking the access-type text expands that zone's rule editor with the success-accent styling", async () => {
      rulesResponses = { z1: [] };
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      await user.click(screen.getByRole("button", { name: "All attendees" }));

      expect(await screen.findByRole("button", { name: "+ or condition" })).toBeInTheDocument();
      const expandedBlock = screen.getByTestId("zone-row-expanded-z1");
      expect(expandedBlock.className).toContain("border-l-success");
      expect(expandedBlock.className).toContain("bg-success/5");
    });

    it("the row's '⋯' menu 'Access rules' item expands the same editor", async () => {
      rulesResponses = { z2: [] };
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("VIP Lounge");

      await user.click(screen.getByRole("button", { name: "More actions for VIP Lounge" }));
      await user.click(await screen.findByRole("menuitem", { name: "Access rules" }));

      expect(await screen.findByTestId("zone-row-expanded-z2")).toBeInTheDocument();
    });

    it("clicking the access-type text again collapses an already-open editor", async () => {
      rulesResponses = { z1: [] };
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      await user.click(screen.getByRole("button", { name: "All attendees" }));
      await screen.findByTestId("zone-row-expanded-z1");
      await user.click(screen.getByRole("button", { name: "All attendees" }));

      expect(screen.queryByTestId("zone-row-expanded-z1")).not.toBeInTheDocument();
    });

    it("opening a different zone's editor is blocked while the current one is dirty, and shows the unsaved hint", async () => {
      rulesResponses = {
        z1: [{
          id: "r1", zone_id: "z1", category: "vip", allowed: true, time_from: null, time_to: null, created_at: "2026-01-01T00:00:00Z",
        }],
        z2: [],
      };
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      await user.click(screen.getByRole("button", { name: "All attendees" }));
      const valueInput = await screen.findByLabelText("Category value 1");
      await user.type(valueInput, "-extra");

      await user.click(screen.getByRole("button", { name: "By rule · 2" }));

      expect(screen.queryByTestId("zone-row-expanded-z2")).not.toBeInTheDocument();
      expect(screen.getByTestId("zone-row-expanded-z1")).toBeInTheDocument();
      expect(
        await screen.findByText("Save or cancel your changes before editing another zone's rules."),
      ).toBeInTheDocument();

      // Cancelling clears the dirty flag, so the previously blocked zone
      // can now be opened.
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "By rule · 2" }));

      expect(await screen.findByTestId("zone-row-expanded-z2")).toBeInTheDocument();
      expect(screen.queryByTestId("zone-row-expanded-z1")).not.toBeInTheDocument();
    });

    it("while a save is pending for the open row, that row's collapse toggle and '⋯' menu are inert; both re-enable once it settles", async () => {
      rulesResponses = { z1: [] };
      putDelayMs = 50;
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      await user.click(screen.getByRole("button", { name: "All attendees" }));
      await screen.findByTestId("zone-row-expanded-z1");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("button", { name: "All attendees" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "More actions for Main Hall" })).toBeDisabled();

      await waitFor(() => expect(screen.queryByTestId("zone-row-expanded-z1")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "More actions for Main Hall" })).toBeEnabled();
    });

    it("deleting the currently-expanded, dirty zone resets the editor state so other zones' editors stay openable", async () => {
      rulesResponses = {
        z1: [{
          id: "r1", zone_id: "z1", category: "vip", allowed: true, time_from: null, time_to: null, created_at: "2026-01-01T00:00:00Z",
        }],
        z2: [],
      };
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      // Expand z1's editor and make it dirty.
      await user.click(screen.getByRole("button", { name: "All attendees" }));
      await user.type(await screen.findByLabelText("Category value 1"), "-extra");

      // Delete z1 through its own row menu (mere dirtiness does not disable
      // the menu — only a pending save does).
      await user.click(screen.getByRole("button", { name: "More actions for Main Hall" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete zone…" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type Main Hall to confirm"), "Main Hall");
      // The post-delete ZONES_KEY refetch must return a list without z1.
      zonesResponse = [zoneWithStats({ id: "z2", name: "VIP Lounge", access_rules_count: 2 })];
      await user.click(within(dialog).getByRole("button", { name: "Delete zone" }));

      await waitFor(() => expect(screen.queryByText("Main Hall")).not.toBeInTheDocument());

      // The stale dirty state must not leak: no orphaned hint anywhere, and
      // another zone's editor must open on the first click.
      expect(
        screen.queryByText("Save or cancel your changes before editing another zone's rules."),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "By rule · 2" }));
      expect(await screen.findByTestId("zone-row-expanded-z2")).toBeInTheDocument();
      expect(
        screen.queryByText("Save or cancel your changes before editing another zone's rules."),
      ).not.toBeInTheDocument();
    });

    it("a rules-fetch error renders error copy with no editable surface, reachable from either entry point", async () => {
      rulesStatusOverride = { z1: 500 };
      const user = userEvent.setup();
      renderAt("/events/evt-1/zones");
      await screen.findByText("Main Hall");

      await user.click(screen.getByRole("button", { name: "All attendees" }));

      expect(await screen.findByText("Couldn't load access rules.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ or condition" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    });
  });
});
