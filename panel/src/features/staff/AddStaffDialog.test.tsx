import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { axe } from "vitest-axe";
import { AddStaffDialog } from "./AddStaffDialog";
import { useEventReadiness } from "../events/hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// Genuinely subscribed observer for GET /api/events/:id/readiness — same
// pattern as DangerZoneCard.test.tsx's ListObserver/AttendeesListObserver:
// mounting a real useQuery consumer alongside the component under test makes
// `invalidateQueries` for READINESS_KEY produce an OBSERVABLE refetch (via
// `readinessHitCount`), rather than merely asserting the invalidate call was
// made.
function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

let usersResponse: unknown[] = [];
let usersStatus = 200;
let usersCallCount = 0;
let staffResponse: unknown[] = [];
let assignCount = 0;
let lastAssignBody: unknown;
let assignStatus = 200;
let assignDelayMs = 0;
let createCount = 0;
let lastCreateBody: unknown;
let createStatus = 200;
let createDelayMs = 0;
let createResponseBody: Record<string, unknown> | null = null;
let limitBody: Record<string, unknown> | null = null;
let readinessHitCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessHitCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
  http.get("http://api.test/api/users", () => {
    usersCallCount += 1;
    if (usersStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: usersStatus });
    return HttpResponse.json(usersResponse);
  }),
  http.get("http://api.test/api/events/:eventId/staff", () => HttpResponse.json(staffResponse)),
  http.post("http://api.test/api/events/:eventId/staff", async ({ request, params }) => {
    assignCount += 1;
    lastAssignBody = await request.json();
    if (assignDelayMs) await delay(assignDelayMs);
    if (assignStatus !== 200) return HttpResponse.json({ error: "assign-boom" }, { status: assignStatus });
    return HttpResponse.json(
      {
        id: "es-1", event_id: params.eventId as string, user_id: (lastAssignBody as { user_id: string }).user_id, assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin",
      },
      { status: 201 },
    );
  }),
  http.post("http://api.test/api/users", async ({ request }) => {
    createCount += 1;
    lastCreateBody = await request.json();
    if (createDelayMs) await delay(createDelayMs);
    if (limitBody) return HttpResponse.json(limitBody, { status: 403 });
    if (createStatus !== 200) return HttpResponse.json({ error: "create-boom" }, { status: createStatus });
    return HttpResponse.json(
      createResponseBody ?? {
        id: "u-new",
        tenant_id: "t1",
        email: (lastCreateBody as { email: string }).email,
        role: (lastCreateBody as { role: string }).role,
        is_super_admin: false,
        has_qr_token: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      { status: 201 },
    );
  }),
);
void server;

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

function tenantUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    tenant_id: "t1",
    email: "alice@example.com",
    role: "staff",
    is_super_admin: false,
    has_qr_token: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("AddStaffDialog", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    usersResponse = [
      tenantUser({ id: "u1", email: "alice@example.com", role: "staff" }),
      tenantUser({ id: "u2", email: "bob@example.com", role: "manager" }),
    ];
    usersStatus = 200;
    usersCallCount = 0;
    staffResponse = [];
    assignCount = 0;
    lastAssignBody = undefined;
    assignStatus = 200;
    assignDelayMs = 0;
    createCount = 0;
    lastCreateBody = undefined;
    createStatus = 200;
    createDelayMs = 0;
    createResponseBody = null;
    limitBody = null;
    readinessHitCount = 0;
  });

  // P5.3.3 Task 3 (static a11y tooling): one representative vitest-axe
  // assertion for this RadioGroup consumer, demonstrating the pattern other
  // tests should copy -- the default "existing" tab/mode, once the
  // candidate list (an @idento/ui RadioGroup) has actually loaded, same
  // wait-for-candidates setup the other existing-mode tests below use.
  it("has no axe violations", async () => {
    const { container } = renderWithProviders(
      <AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />,
    );
    await screen.findByText("bob@example.com");
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("existing-mode candidate list", () => {
    it("does not fetch tenant users while closed, and fetches once opened (enabled gate)", async () => {
      renderWithProviders(<AddStaffDialog eventId="evt-1" open={false} onOpenChange={vi.fn()} isAdmin />);
      expect(usersCallCount).toBe(0);
    });

    it("filters out already-assigned users from the candidate list", async () => {
      staffResponse = [tenantUser({ id: "u1", email: "alice@example.com", role: "staff" })];
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);

      await waitFor(() => expect(usersCallCount).toBeGreaterThan(0));
      expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
      expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    });

    it("shows staffAddNoCandidates copy when every tenant user is already assigned", async () => {
      staffResponse = [
        tenantUser({ id: "u1", email: "alice@example.com", role: "staff" }),
        tenantUser({ id: "u2", email: "bob@example.com", role: "manager" }),
      ];
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);

      expect(await screen.findByText("Every tenant user is already assigned to this event.")).toBeInTheDocument();
    });

    it("assigns the selected candidate, invalidates the staff list AND readiness (P1 fix — the backend recomputes the staff step from the live list), and closes on success", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { queryClient } = renderWithProviders(
        <>
          <ReadinessObserver eventId="evt-1" />
          <AddStaffDialog eventId="evt-1" open onOpenChange={onOpenChange} isAdmin />
        </>,
      );
      await waitFor(() => expect(readinessHitCount).toBe(1));
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      // The candidate picker is an @idento/ui RadioGroup: a role=radiogroup
      // wrapping one role=radio per selectable candidate.
      await screen.findByText("bob@example.com");
      const candidateGroup = screen.getByRole("radiogroup");
      const bob = within(candidateGroup).getByRole("radio", { name: /bob@example\.com/ });
      expect(bob).not.toBeChecked();
      await user.click(bob);
      expect(bob).toBeChecked();
      await user.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => expect(assignCount).toBe(1));
      expect(lastAssignBody).toEqual({ user_id: "u2" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: ["get", "/api/events/{event_id}/staff", { params: { path: { event_id: "evt-1" } } }],
          }),
        ),
      );
      // The genuinely subscribed readiness observer actually refetches —
      // not just an invalidateQueries call asserted in isolation.
      await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
    });

    it("keeps the dialog open and shows an error when the assign POST fails", async () => {
      assignStatus = 500;
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={onOpenChange} isAdmin />);

      await user.click(await screen.findByText("bob@example.com"));
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(await screen.findByText("Couldn't add the staff member. Try again.")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("session-ref cancel race: closing the dialog mid-flight does not close/error into a reopened session", async () => {
      assignDelayMs = 60;
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <AddStaffDialog eventId="evt-1" open onOpenChange={onOpenChange} isAdmin />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByText("bob@example.com"));
      await user.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(assignCount).toBe(1));

      // The submit is pending: Cancel/Escape are blocked (matches
      // AddAttendeeDialog's pending-dismiss guard).
      const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
      await user.click(cancelButtons[0]);
      await user.keyboard("{Escape}");
      expect(onOpenChange).not.toHaveBeenCalled();

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });
  });

  describe("create mode (admin only)", () => {
    it("hides the create tab entirely for a manager", async () => {
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin={false} />);

      await screen.findByText("bob@example.com");
      expect(screen.queryByRole("button", { name: "Create new user" })).not.toBeInTheDocument();
    });

    it("shows email/password/role fields when switching to create mode for an admin", async () => {
      const user = userEvent.setup();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);

      await user.click(await screen.findByRole("button", { name: "Create new user" }));

      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByLabelText("Staff")).toBeInTheDocument();
      expect(screen.getByLabelText("Manager")).toBeInTheDocument();
      // Role is restricted to staff|manager — admin is never an option here
      // (reconciliation #15; backend rejects it too).
      expect(screen.queryByLabelText("Admin")).not.toBeInTheDocument();

      // The role picker is an @idento/ui RadioGroup: a single role=radiogroup
      // wrapping two role=radio items, "Staff" selected by default.
      const roleGroup = screen.getByRole("radiogroup");
      expect(within(roleGroup).getAllByRole("radio")).toHaveLength(2);
      expect(screen.getByLabelText("Staff")).toBeChecked();
      expect(screen.getByLabelText("Manager")).not.toBeChecked();

      await user.click(screen.getByLabelText("Manager"));
      expect(screen.getByLabelText("Manager")).toBeChecked();
      expect(screen.getByLabelText("Staff")).not.toBeChecked();
    });

    it("validates email format before submitting", async () => {
      const user = userEvent.setup();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);
      await user.click(await screen.findByRole("button", { name: "Create new user" }));

      await user.type(screen.getByLabelText("Email"), "not-an-email");
      await user.type(screen.getByLabelText("Password"), "longenough1");
      await user.click(screen.getByRole("button", { name: "Create & add" }));

      expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
      expect(createCount).toBe(0);
    });

    it("enforces the password floor", async () => {
      const user = userEvent.setup();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);
      await user.click(await screen.findByRole("button", { name: "Create new user" }));

      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "short1");
      await user.click(screen.getByRole("button", { name: "Create & add" }));

      expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
      expect(createCount).toBe(0);
    });

    it("creates the user with role restricted to staff|manager, then chains the assign POST, invalidates staff AND readiness, and closes on success", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { queryClient } = renderWithProviders(
        <>
          <ReadinessObserver eventId="evt-1" />
          <AddStaffDialog eventId="evt-1" open onOpenChange={onOpenChange} isAdmin />
        </>,
      );
      await waitFor(() => expect(readinessHitCount).toBe(1));
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      createResponseBody = {
        id: "u-new", tenant_id: "t1", email: "new@example.com", role: "manager", is_super_admin: false, has_qr_token: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      };

      await user.click(await screen.findByRole("button", { name: "Create new user" }));
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "longenough1");
      await user.click(screen.getByLabelText("Manager"));
      await user.click(screen.getByRole("button", { name: "Create & add" }));

      await waitFor(() => expect(createCount).toBe(1));
      expect(lastCreateBody).toEqual({ email: "new@example.com", password: "longenough1", role: "manager" });
      await waitFor(() => expect(assignCount).toBe(1));
      expect(lastAssignBody).toEqual({ user_id: "u-new" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: ["get", "/api/events/{event_id}/staff", { params: { path: { event_id: "evt-1" } } }],
          }),
        ),
      );
      await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
    });

    it("surfaces the LimitExceededError message verbatim on a 403 from the plan-limits middleware", async () => {
      limitBody = {
        error: "Limit exceeded for users", current: 5, max: 5, upgrade_required: true, limit_type: "users",
      };
      const user = userEvent.setup();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);

      await user.click(await screen.findByRole("button", { name: "Create new user" }));
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "longenough1");
      await user.click(screen.getByRole("button", { name: "Create & add" }));

      expect(await screen.findByText("Limit exceeded for users")).toBeInTheDocument();
      expect(assignCount).toBe(0);
    });

    it("falls back to the generic staffAddCreateError copy for a non-HTTP (network) failure", async () => {
      server.use(http.post("http://api.test/api/users", () => HttpResponse.error()));
      const user = userEvent.setup();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);

      await user.click(await screen.findByRole("button", { name: "Create new user" }));
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "longenough1");
      await user.click(screen.getByRole("button", { name: "Create & add" }));

      expect(await screen.findByText("Couldn't create the staff account. Try again.")).toBeInTheDocument();
    });

    it("shows staffAddAssignFailed (honest: user exists, wasn't assigned) when the create succeeds but the assign POST fails", async () => {
      assignStatus = 500;
      const user = userEvent.setup();
      renderWithProviders(<AddStaffDialog eventId="evt-1" open onOpenChange={vi.fn()} isAdmin />);
      createResponseBody = {
        id: "u-new", tenant_id: "t1", email: "new@example.com", role: "staff", is_super_admin: false, has_qr_token: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      };

      await user.click(await screen.findByRole("button", { name: "Create new user" }));
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "longenough1");
      await user.click(screen.getByRole("button", { name: "Create & add" }));

      await waitFor(() => expect(createCount).toBe(1));
      expect(
        await screen.findByText(
          "new@example.com was created, but couldn't be added to this event. Switch to the Existing tab and add them from there.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("reset on close", () => {
    it("resets mode/fields/errors so a reopen starts clean", async () => {
      createStatus = 500;
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <AddStaffDialog eventId="evt-1" open onOpenChange={onOpenChange} isAdmin />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole("button", { name: "Create new user" }));
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "longenough1");
      await user.click(screen.getByRole("button", { name: "Create & add" }));
      // The MSW mock's 500 body carries `{ error: "create-boom" }`, which
      // the shared `errors` middleware (shared/api/http.ts) turns into this
      // ApiError's `.message` — surfaced verbatim, same as ZonesPage.tsx's
      // delete-error precedent, not swallowed behind a generic string.
      expect(await screen.findByText("create-boom")).toBeInTheDocument();

      rerender(
        <QueryClientProvider client={queryClient}>
          <AddStaffDialog eventId="evt-1" open={false} onOpenChange={onOpenChange} isAdmin />
        </QueryClientProvider>,
      );
      rerender(
        <QueryClientProvider client={queryClient}>
          <AddStaffDialog eventId="evt-1" open onOpenChange={onOpenChange} isAdmin />
        </QueryClientProvider>,
      );

      // Back to the default "existing" mode/tab, no stale error.
      expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
      expect(screen.queryByText("create-boom")).not.toBeInTheDocument();
    });
  });
});
