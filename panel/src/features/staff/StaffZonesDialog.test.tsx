import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { StaffZonesDialog } from "./StaffZonesDialog";
import type { StaffUser } from "./hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let zonesResponse: unknown[] = [];
let assignmentsResponse: unknown[] = [];
let assignCalls: { zoneId: string; body: unknown }[] = [];
let removeCalls: { zoneId: string; userId: string }[] = [];
let assignStatusByZone: Record<string, number> = {};
let removeStatusByZone: Record<string, number> = {};
let assignDelayByZone: Record<string, number> = {};
let removeDelayByZone: Record<string, number> = {};

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(zonesResponse)),
  http.get("http://api.test/api/users/:userId/zones", () => HttpResponse.json(assignmentsResponse)),
  http.post("http://api.test/api/zones/:zoneId/staff", async ({ request, params }) => {
    const zoneId = params.zoneId as string;
    const body = await request.json();
    assignCalls.push({ zoneId, body });
    const delayMs = assignDelayByZone[zoneId];
    if (delayMs) await delay(delayMs);
    const status = assignStatusByZone[zoneId];
    if (status && status !== 201) return HttpResponse.json({ error: "assign-boom" }, { status });
    return HttpResponse.json(
      {
        id: "sza-fresh", user_id: (body as { user_id: string }).user_id, zone_id: zoneId, assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin",
      },
      { status: 201 },
    );
  }),
  http.delete("http://api.test/api/zones/:zoneId/staff/:userId", async ({ params }) => {
    const zoneId = params.zoneId as string;
    const userId = params.userId as string;
    removeCalls.push({ zoneId, userId });
    const delayMs = removeDelayByZone[zoneId];
    if (delayMs) await delay(delayMs);
    const status = removeStatusByZone[zoneId];
    if (status && status !== 200) return HttpResponse.json({ error: "remove-boom" }, { status });
    return HttpResponse.json({ message: "Staff removed from zone" });
  }),
);
void server;

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

function staffUser(overrides: Partial<StaffUser> = {}): StaffUser {
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

describe("StaffZonesDialog", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    zonesResponse = [
      { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: true, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
      { id: "z2", event_id: "evt-1", name: "VIP", zone_type: "general", order_index: 1, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
    ];
    assignmentsResponse = [
      { id: "a1", user_id: "u1", zone_id: "z1", assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u-admin" },
    ];
    assignCalls = [];
    removeCalls = [];
    assignStatusByZone = {};
    removeStatusByZone = {};
    assignDelayByZone = {};
    removeDelayByZone = {};
  });

  it("renders one Switch per zone, checked exactly for zones with an existing assignment", async () => {
    renderWithProviders(
      <StaffZonesDialog user={staffUser()} eventId="evt-1" open onOpenChange={vi.fn()} />,
    );

    const mainHall = await screen.findByRole("switch", { name: "Main hall" });
    const vip = screen.getByRole("switch", { name: "VIP" });
    expect(mainHall).toBeChecked();
    expect(vip).not.toBeChecked();
  });

  it("toggling an unassigned zone on POSTs {user_id} to /api/zones/:zoneId/staff", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffZonesDialog user={staffUser({ id: "u1" })} eventId="evt-1" open onOpenChange={vi.fn()} />);

    const vip = await screen.findByRole("switch", { name: "VIP" });
    await user.click(vip);

    await waitFor(() => expect(assignCalls).toEqual([{ zoneId: "z2", body: { user_id: "u1" } }]));
  });

  it("toggling an assigned zone off DELETEs by zone_id + user_id path params (no body)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffZonesDialog user={staffUser({ id: "u1" })} eventId="evt-1" open onOpenChange={vi.fn()} />);

    const mainHall = await screen.findByRole("switch", { name: "Main hall" });
    await user.click(mainHall);

    await waitFor(() => expect(removeCalls).toEqual([{ zoneId: "z1", userId: "u1" }]));
  });

  it("invalidates USER_ZONES_KEY(user.id) unconditionally on both a successful and a failed toggle", async () => {
    assignStatusByZone = { z2: 500 };
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(
      <StaffZonesDialog user={staffUser({ id: "u1" })} eventId="evt-1" open onOpenChange={vi.fn()} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // Successful toggle (off Main hall).
    await user.click(await screen.findByRole("switch", { name: "Main hall" }));
    await waitFor(() => expect(removeCalls).toHaveLength(1));
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["get", "/api/users/{user_id}/zones", { params: { path: { user_id: "u1" } } }] }),
    );
    invalidateSpy.mockClear();

    // Failed toggle (on VIP, assign 500s).
    await user.click(screen.getByRole("switch", { name: "VIP" }));
    await waitFor(() => expect(assignCalls).toHaveLength(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["get", "/api/users/{user_id}/zones", { params: { path: { user_id: "u1" } } }] }),
      ),
    );
  });

  it("a failed toggle reverts the switch's visual state and shows staffZonesToggleError", async () => {
    assignStatusByZone = { z2: 500 };
    const user = userEvent.setup();
    renderWithProviders(<StaffZonesDialog user={staffUser({ id: "u1" })} eventId="evt-1" open onOpenChange={vi.fn()} />);

    const vip = await screen.findByRole("switch", { name: "VIP" });
    await user.click(vip);

    await waitFor(() => expect(assignCalls).toHaveLength(1));
    expect(await screen.findByText("Couldn't update zone access. Try again.")).toBeInTheDocument();
    // Reverted: still reads the pre-toggle (unassigned) state, never a
    // silently-accepted "looks assigned now" lie.
    await waitFor(() => expect(screen.getByRole("switch", { name: "VIP" })).not.toBeChecked());
  });

  it("per-row pending: a busy row's own Switch is disabled, but OTHER rows stay enabled (never blocked by a shared mutation state)", async () => {
    assignDelayByZone = { z2: 60 };
    const user = userEvent.setup();
    renderWithProviders(<StaffZonesDialog user={staffUser({ id: "u1" })} eventId="evt-1" open onOpenChange={vi.fn()} />);

    const vip = await screen.findByRole("switch", { name: "VIP" });
    const mainHall = screen.getByRole("switch", { name: "Main hall" });
    await user.click(vip);

    // VIP's own row is now pending/disabled...
    await waitFor(() => expect(vip).toBeDisabled());
    // ...but Main hall's row is untouched and still interactive.
    expect(mainHall).toBeEnabled();
    await user.click(mainHall);
    await waitFor(() => expect(removeCalls).toEqual([{ zoneId: "z1", userId: "u1" }]));

    await waitFor(() => expect(vip).toBeEnabled());
  });

  it("blocks dialog dismissal only while a toggle is genuinely pending (exhaustive gate)", async () => {
    assignDelayByZone = { z2: 60 };
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<StaffZonesDialog user={staffUser({ id: "u1" })} eventId="evt-1" open onOpenChange={onOpenChange} />);

    await user.click(await screen.findByRole("switch", { name: "VIP" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "VIP" })).toBeDisabled());

    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();

    await waitFor(() => expect(assignCalls).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("switch", { name: "VIP" })).toBeEnabled());

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows its own zones-loading copy while fetching (never the tenant-users copy from AddStaffDialog)", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/zones", async () => {
        await delay(30);
        return HttpResponse.json(zonesResponse);
      }),
    );
    renderWithProviders(<StaffZonesDialog user={staffUser()} eventId="evt-1" open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("Loading zones…")).toBeInTheDocument();
    expect(screen.queryByText("Loading tenant users…")).not.toBeInTheDocument();
  });

  it("shows a distinct load-error message (never an empty zone list) when the zones fetch fails", async () => {
    server.use(http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    renderWithProviders(<StaffZonesDialog user={staffUser()} eventId="evt-1" open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("Couldn't load zones for this staff member.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("shows the empty-zones copy when the event has no zones", async () => {
    zonesResponse = [];
    renderWithProviders(<StaffZonesDialog user={staffUser()} eventId="evt-1" open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("This event has no zones yet.")).toBeInTheDocument();
  });
});
