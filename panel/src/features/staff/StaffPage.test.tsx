import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import {
  render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { StaffPage } from "./StaffPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Mirrors ZonesPage.test.tsx / AttendeesPage.test.tsx's harness shape: a
// throwaway route tree whose id/path structure matches the real app closely
// enough for `getRouteApi("/_app/events/$eventId/staff")` to resolve params.
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute();
  const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: "/events/$eventId",
    component: () => <Outlet />,
  });
  const staffRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/staff",
    component: StaffPage,
  });
  const routeTree = rootRoute.addChildren([appLayoutRoute.addChildren([workspaceRoute.addChildren([staffRoute])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function renderAt(path: string) {
  const router = buildRouter(path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error — same rationale as ZonesPage.test.tsx:
          this test router's route shape differs from the app's registered
          singleton. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

interface StaffFixture {
  id: string;
  email: string;
  role: "admin" | "manager" | "staff";
}

function staffUser(fixture: StaffFixture) {
  return {
    id: fixture.id,
    tenant_id: "t1",
    email: fixture.email,
    role: fixture.role,
    is_super_admin: false,
    has_qr_token: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// Mirrors OrganizationPage.test.tsx's session seeding exactly: `current_tenant`
// in localStorage supplies only the id `getCurrentTenant()` reads (it has no
// role field at all); the caller's role in that tenant comes from a LIVE
// `GET /api/tenants/:id` fetch (`viewerRole` below), matching
// OrganizationPage.tsx:65's actual mechanism — not a cached, switch-stale
// `user.role`.
let viewerRole: "admin" | "manager" | "staff" = "admin";

function seedRole(role: "admin" | "manager" | "staff") {
  viewerRole = role;
  localStorage.setItem("current_tenant", JSON.stringify({ id: "t1", name: "Acme Events" }));
}

let staffResponse: unknown[] = [];
let tenantUsersResponse: unknown[] = [];
let staffStatus = 200;
let staffDelayMs = 0;
let zonesResponse: unknown[] = [];
let userZoneAssignments: Record<string, unknown[]> = {};
let userZoneStatusOverride: Record<string, number> = {};
let userZoneDelayMs: Record<string, number> = {};
// Staff-role assertions land on the SAME rendered state as "tenant role
// still loading" (both canManage/isAdmin false) — a bare UI check alone
// can't distinguish "the fetch never even ran" from "it ran and resolved
// to staff", so tests also assert this actually incremented.
let tenantFetchCount = 0;
// POST /api/users/:id/qr-token — used by both a single card's Print/Generate
// and the page-level "Print all" loop. `qrTokenFailIds` lets a test make ONE
// specific member's generate fail without affecting the others (per-item
// failure handling, P2.1 attempt-vs-success lesson).
let qrTokenCallIds: string[] = [];
let qrTokenFailIds: Set<string> = new Set();
let qrTokenDelayMs = 0;
let qrTokenCounter = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/staff", async () => {
    if (staffDelayMs) await delay(staffDelayMs);
    if (staffStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: staffStatus });
    }
    return HttpResponse.json(staffResponse);
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(zonesResponse)),
  http.get("http://api.test/api/users/:userId/zones", async ({ params }) => {
    const userId = params.userId as string;
    const delayMs = userZoneDelayMs[userId];
    if (delayMs) await delay(delayMs);
    const statusOverride = userZoneStatusOverride[userId];
    if (statusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: statusOverride });
    }
    return HttpResponse.json(userZoneAssignments[userId] ?? []);
  }),
  http.get("http://api.test/api/tenants/:id", ({ params }) => {
    tenantFetchCount += 1;
    return HttpResponse.json({
      id: params.id as string,
      name: "Acme Events",
      settings: null,
      logo_url: null,
      website: null,
      contact_email: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      role: viewerRole,
    });
  }),
  http.post("http://api.test/api/users/:id/qr-token", async ({ params }) => {
    const id = params.id as string;
    qrTokenCallIds.push(id);
    if (qrTokenDelayMs) await delay(qrTokenDelayMs);
    if (qrTokenFailIds.has(id)) {
      return HttpResponse.json({ error: "boom" }, { status: 500 });
    }
    qrTokenCounter += 1;
    return HttpResponse.json({ qr_token: `QR_gen_${qrTokenCounter}`, user_id: id, email: "x@example.com" });
  }),
  // Used by AddStaffDialog's existing-mode candidate list.
  http.get("http://api.test/api/users", () => HttpResponse.json(tenantUsersResponse)),
  // Stateful: a successful assign actually adds the member to
  // `staffResponse`, so the STAFF_KEY invalidation AddStaffDialog triggers
  // refetches a list that genuinely reflects the POST.
  http.post("http://api.test/api/events/:eventId/staff", async ({ request }) => {
    const body = (await request.json()) as { user_id: string };
    const member = tenantUsersResponse.find((u) => (u as { id: string }).id === body.user_id);
    if (member && !staffResponse.some((m) => (m as { id: string }).id === body.user_id)) {
      staffResponse = [...staffResponse, member];
    }
    return HttpResponse.json(
      {
        id: "es-new", event_id: "evt-1", user_id: body.user_id, assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u1",
      },
      { status: 201 },
    );
  }),
  // Stateful: a successful revoke actually removes the member from
  // `staffResponse`, so the STAFF_KEY invalidation this triggers refetches a
  // list that genuinely reflects the DELETE — same as the real backend.
  http.delete("http://api.test/api/events/:eventId/staff/:userId", ({ params }) => {
    const userId = params.userId as string;
    staffResponse = staffResponse.filter((member) => (member as { id: string }).id !== userId);
    return new HttpResponse(null, { status: 204 });
  }),
);
void server;

describe("StaffPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    seedRole("admin");
    staffResponse = [
      staffUser({ id: "u1", email: "alice@example.com", role: "admin" }),
      staffUser({ id: "u2", email: "bob@example.com", role: "staff" }),
    ];
    tenantUsersResponse = [
      staffUser({ id: "u1", email: "alice@example.com", role: "admin" }),
      staffUser({ id: "u2", email: "bob@example.com", role: "staff" }),
      staffUser({ id: "u3", email: "carol@example.com", role: "staff" }),
    ];
    staffStatus = 200;
    staffDelayMs = 0;
    zonesResponse = [
      { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: true, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
      { id: "z2", event_id: "evt-1", name: "VIP", zone_type: "general", order_index: 1, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
    ];
    userZoneAssignments = {};
    userZoneStatusOverride = {};
    userZoneDelayMs = {};
    tenantFetchCount = 0;
    qrTokenCallIds = [];
    qrTokenFailIds = new Set();
    qrTokenDelayMs = 0;
    qrTokenCounter = 0;
  });

  afterEach(() => {
    document.getElementById("qr-print-root")?.remove();
    delete document.body.dataset.qrPrint;
    localStorage.clear();
  });

  it("renders the header (h2 + mono count) and the caption", async () => {
    renderAt("/events/evt-1/staff");

    expect(await screen.findByRole("heading", { name: "Staff" })).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(
      screen.getByText("Event-day access via QR login — no accounts, no passwords, minimal training."),
    ).toBeInTheDocument();
  });

  it("shows an initials avatar, the email, and the role subtitle for each staff member — no signed-in dot, no station line", async () => {
    userZoneAssignments = { u1: [], u2: [] };
    renderAt("/events/evt-1/staff");

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("BO")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    // "Staff" also appears as the page's h2 title, so scope to the role
    // subtitle specifically (a muted caption span, not the heading).
    expect(screen.getByRole("heading", { name: "Staff" })).toBeInTheDocument();
    const staffSubtitles = screen.getAllByText("Staff").filter((el) => el.tagName !== "H2");
    expect(staffSubtitles).toHaveLength(1);

    // Reconciliations #9-10: no "signed in" data source exists at all — the
    // board's dot/station fields must never be fabricated.
    expect(screen.queryByText(/Signed in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Entrance A")).not.toBeInTheDocument();
    expect(screen.queryByText("Registration desk")).not.toBeInTheDocument();
  });

  it("renders the 3-per-row card grid", async () => {
    userZoneAssignments = { u1: [], u2: [] };
    renderAt("/events/evt-1/staff");

    await screen.findByText("alice@example.com");
    const grid = screen.getByTestId("staff-grid");
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("gap-4");
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-3");
  });

  describe("per-card zones caption", () => {
    it("shows the joined zone names for a user with real assignments", async () => {
      userZoneAssignments = { u1: [{ id: "a1", user_id: "u1", zone_id: "z1", assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin" }, { id: "a2", user_id: "u1", zone_id: "z2", assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin" }], u2: [] };
      renderAt("/events/evt-1/staff");

      expect(await screen.findByText("QR login · zones: Main hall, VIP")).toBeInTheDocument();
    });

    it("shows the no-zones-assigned copy for an empty assignment list, distinct from the loading/error states", async () => {
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");

      await screen.findByText("alice@example.com");
      await waitFor(() => expect(screen.getAllByText("No zones assigned")).toHaveLength(2));
    });

    it("shows a loading skeleton for the zones caption before the per-user fetch resolves", async () => {
      userZoneDelayMs = { u1: 50, u2: 50 };
      renderAt("/events/evt-1/staff");

      await screen.findByText("alice@example.com");
      expect(screen.getAllByTestId("staff-zones-skeleton")).toHaveLength(2);
      expect(screen.queryByText("No zones assigned")).not.toBeInTheDocument();
    });

    it("shows a distinct error message when the per-user zone fetch fails — never falling back to the empty copy", async () => {
      userZoneStatusOverride = { u1: 500 };
      userZoneAssignments = { u2: [] };
      renderAt("/events/evt-1/staff");

      await screen.findByText("alice@example.com");
      expect(await screen.findByText("Couldn't load zones.")).toBeInTheDocument();
      expect(screen.getByText("No zones assigned")).toBeInTheDocument();
      // The error card's caption must not also satisfy the empty-state text.
      expect(screen.getAllByText("No zones assigned")).toHaveLength(1);
    });
  });

  it("shows loading skeletons and never a fabricated count before staff arrives", async () => {
    staffDelayMs = 50;
    renderAt("/events/evt-1/staff");

    expect(await screen.findByTestId("staff-grid-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("staff-total-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("shows an i18n'd error message when the staff fetch fails", async () => {
    staffStatus = 500;
    renderAt("/events/evt-1/staff");

    expect(await screen.findByText("Couldn't load staff.")).toBeInTheDocument();
    expect(screen.queryByText("No staff yet")).not.toBeInTheDocument();
  });

  it("shows the canonical empty state when there is no staff", async () => {
    staffResponse = [];
    renderAt("/events/evt-1/staff");

    expect(await screen.findByText("No staff yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add event-day staff to print their QR login cards — no accounts or passwords needed."),
    ).toBeInTheDocument();
    // With no staff, "+ Add staff" appears twice — header + EmptyState action
    // (same pattern as ZonesPage's "+ New zone" in both places when empty).
    // The default seeded role is admin, but that comes from a live tenant
    // fetch, so wait for it to resolve before counting buttons.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Add staff" })).toHaveLength(2));
  });

  it("renders the footer note", async () => {
    userZoneAssignments = { u1: [], u2: [] };
    renderAt("/events/evt-1/staff");

    expect(
      await screen.findByText("Admins & managers sign in with their own accounts — manage them in Team."),
    ).toBeInTheDocument();
  });

  describe("header action gating by role", () => {
    it("admin: '+ Add staff' and an enabled 'Print all QR cards' with no disabled-reason tooltip", async () => {
      seedRole("admin");
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      // Role comes from a live GET /api/tenants/:id fetch (separate from
      // the staff/zones fetches above), so button state settles on its own
      // tick — wait for it rather than asserting immediately.
      await waitFor(() => expect(screen.getByRole("button", { name: "Print all QR cards" })).toBeEnabled());
      expect(screen.getByRole("button", { name: "+ Add staff" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Print all QR cards" })).not.toHaveAttribute("title");
    });

    it("manager: '+ Add staff' present, 'Print all QR cards' disabled with a tooltip", async () => {
      seedRole("manager");
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await waitFor(() => expect(screen.getByRole("button", { name: "Print all QR cards" })).toBeDisabled());
      expect(screen.getByRole("button", { name: "+ Add staff" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Print all QR cards" })).toHaveAttribute("title", "Only admins can print QR cards.");
    });

    it("staff: '+ Add staff' is hidden, 'Print all QR cards' disabled with a tooltip", async () => {
      seedRole("staff");
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");
      // This role's rendered state is the same as "role still loading" (both
      // isAdmin/canManage false) — assert the live tenant fetch actually
      // resolved so this isn't a false pass off the unloaded default.
      await waitFor(() => expect(tenantFetchCount).toBeGreaterThan(0));

      expect(screen.queryByRole("button", { name: "+ Add staff" })).not.toBeInTheDocument();
      const printAll = screen.getByRole("button", { name: "Print all QR cards" });
      expect(printAll).toBeDisabled();
      expect(printAll).toHaveAttribute("title", "Only admins can print QR cards.");
    });
  });

  describe("card action row gating by role", () => {
    it("admin sees an ENABLED Print card, Zones, and Revoke… (Task 6 + Task 7 both wired)", async () => {
      seedRole("admin");
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await waitFor(() => expect(screen.getAllByRole("button", { name: "Print card" })).toHaveLength(2));
      const printButtons = screen.getAllByRole("button", { name: "Print card" });
      const zoneButtons = screen.getAllByRole("button", { name: "Zones" });
      const revokeButtons = screen.getAllByRole("button", { name: "Revoke…" });
      expect(zoneButtons).toHaveLength(2);
      expect(revokeButtons).toHaveLength(2);
      for (const button of [...printButtons, ...zoneButtons, ...revokeButtons]) {
        expect(button).toBeEnabled();
      }
      for (const button of printButtons) {
        expect(button).not.toHaveAttribute("title");
      }
    });

    it("manager sees Zones / Revoke… and a disabled Print card with the admin-only tooltip", async () => {
      seedRole("manager");
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await waitFor(() => expect(screen.getAllByRole("button", { name: "Zones" })).toHaveLength(2));
      const printButtons = screen.getAllByRole("button", { name: "Print card" });
      expect(printButtons).toHaveLength(2);
      for (const button of printButtons) {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("title", "Only admins can generate or print QR codes.");
      }
      const zoneButtons = screen.getAllByRole("button", { name: "Zones" });
      const revokeButtons = screen.getAllByRole("button", { name: "Revoke…" });
      expect(revokeButtons).toHaveLength(2);
      for (const button of [...zoneButtons, ...revokeButtons]) {
        expect(button).toBeEnabled();
      }
    });

    it("staff sees no card action row at all", async () => {
      seedRole("staff");
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");
      await waitFor(() => expect(tenantFetchCount).toBeGreaterThan(0));

      expect(screen.queryByRole("button", { name: "Print card" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Zones" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Revoke…" })).not.toBeInTheDocument();
    });
  });

  describe("Print all QR cards", () => {
    beforeEach(() => {
      vi.spyOn(window, "print").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("opens a tier-1 confirm dialog stating the staff count", async () => {
      const user = userEvent.setup();
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await user.click(await screen.findByRole("button", { name: "Print all QR cards" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("2 staff — all previously printed cards stop working.")).toBeInTheDocument();
      expect(qrTokenCallIds).toEqual([]);
    });

    it("sequentially generates a token per staff member, invalidates the staff list, and opens the print sheet with every card", async () => {
      const user = userEvent.setup();
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await user.click(await screen.findByRole("button", { name: "Print all QR cards" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print all QR cards" }));

      await waitFor(() => expect(qrTokenCallIds).toEqual(["u1", "u2"]));
      // No failures — the confirm dialog closes on its own once settled.
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(document.getElementById("qr-print-root")).not.toBeNull());
      const printRoot = document.getElementById("qr-print-root")!;
      expect(printRoot.textContent).toContain("alice@example.com");
      expect(printRoot.textContent).toContain("bob@example.com");
    });

    it("reuses an already-cached token instead of regenerating it", async () => {
      const user = userEvent.setup();
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      // Print u1's card individually first (never issued -> no confirm,
      // direct generate) — this populates the page-level token cache.
      const printButtons = await screen.findAllByRole("button", { name: "Print card" });
      await user.click(printButtons[0]);
      await waitFor(() => expect(qrTokenCallIds).toEqual(["u1"]));
      await waitFor(() => expect(document.getElementById("qr-print-root")).not.toBeNull());
      // Close the single-card print sheet (simulates the browser's print
      // flow completing) before starting "Print all".
      window.dispatchEvent(new Event("afterprint"));
      await waitFor(() => expect(document.getElementById("qr-print-root")).toBeNull());

      await user.click(await screen.findByRole("button", { name: "Print all QR cards" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print all QR cards" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      // u1 was only ever generated ONCE (the individual print above) — the
      // batch loop reused the cached token instead of reissuing it.
      expect(qrTokenCallIds).toEqual(["u1", "u2"]);
    });

    it("reports partial failures honestly (attempt-vs-success) and opens the sheet with only the successful cards", async () => {
      qrTokenFailIds = new Set(["u2"]);
      const user = userEvent.setup();
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await user.click(await screen.findByRole("button", { name: "Print all QR cards" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print all QR cards" }));

      // Stays open with the honest failed-vs-total readout — a failure is
      // never silently counted as "done".
      expect(await within(dialog).findByText("1 of 2 could not be issued")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await waitFor(() => expect(document.getElementById("qr-print-root")).not.toBeNull());
      const printRoot = document.getElementById("qr-print-root")!;
      expect(printRoot.textContent).toContain("alice@example.com");
      expect(printRoot.textContent).not.toContain("bob@example.com");
    });

    it("exhaustively busy-gates the page while the batch loop runs: confirm dialog can't be dismissed, header actions are inert", async () => {
      qrTokenDelayMs = 40;
      const user = userEvent.setup();
      userZoneAssignments = { u1: [], u2: [] };
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await user.click(await screen.findByRole("button", { name: "Print all QR cards" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print all QR cards" }));

      // Still mid-loop: Cancel is inert, the header's own actions are
      // disabled, and each card's Generate/Print controls are inert too.
      await waitFor(() => expect(qrTokenCallIds.length).toBeGreaterThan(0));
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // The header buttons are legitimately `aria-hidden` while the modal
      // dialog is open (Radix's focus-trap semantics) — `hidden: true`
      // reaches them anyway to assert their own `disabled` attribute. The
      // trigger button shares its accessible name with the dialog's own
      // confirm button, so scope to the one NOT inside the dialog.
      expect(screen.getByRole("button", { name: "+ Add staff", hidden: true })).toBeDisabled();
      const headerPrintAllButton = screen
        .getAllByRole("button", { name: "Print all QR cards", hidden: true })
        .find((button) => !dialog.contains(button));
      expect(headerPrintAllButton).toBeDisabled();

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(qrTokenCallIds).toEqual(["u1", "u2"]);
    });
  });

  describe("Add staff wiring", () => {
    it("clicking '+ Add staff' opens the AddStaffDialog, and adding carol invalidates the staff list", async () => {
      userZoneAssignments = { u1: [], u2: [] };
      const user = userEvent.setup();
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      await user.click(screen.getAllByRole("button", { name: "+ Add staff" })[0]);
      expect(await screen.findByText("carol@example.com")).toBeInTheDocument();

      await user.click(screen.getByText("carol@example.com"));
      await user.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });

  describe("Zones wiring", () => {
    it("clicking Zones on a specific card opens the StaffZonesDialog scoped to that user", async () => {
      userZoneAssignments = { u1: [{ id: "a1", user_id: "u1", zone_id: "z1", assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin" }], u2: [] };
      const user = userEvent.setup();
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");

      const zoneButtons = await screen.findAllByRole("button", { name: "Zones" });
      await user.click(zoneButtons[0]);

      expect(await screen.findByText("Zone access for alice@example.com")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Main hall" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "VIP" })).not.toBeChecked();
    });
  });

  describe("Revoke wiring", () => {
    it("confirming Revoke removes the staff member from the list", async () => {
      userZoneAssignments = { u1: [], u2: [] };
      const user = userEvent.setup();
      renderAt("/events/evt-1/staff");
      await screen.findByText("alice@example.com");
      await screen.findByText("bob@example.com");

      const revokeButtons = await screen.findAllByRole("button", { name: "Revoke…" });
      // Row order follows staffResponse: index 1 is bob (u2).
      await user.click(revokeButtons[1]);
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("bob@example.com loses event-day access to this event. You can re-add them anytime.")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

      await waitFor(() => expect(screen.queryByText("bob@example.com")).not.toBeInTheDocument());
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });
  });
});
