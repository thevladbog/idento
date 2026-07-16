import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { StaffCard, type StaffCardProps } from "./StaffCard";
import type { StaffUser } from "./hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let qrTokenCallCount = 0;
let qrTokenCallIds: string[] = [];
let qrTokenStatus = 200;
let qrTokenDelayMs = 0;
let qrTokenCounter = 0;
let zonesResponse: unknown[] = [];
let userZonesResponse: unknown[] = [];
let revokeCalls: { eventId: string; userId: string }[] = [];
let revokeStatus = 200;
let revokeDelayMs = 0;

const server = startMswServer(
  http.post("http://api.test/api/users/:id/qr-token", async ({ params }) => {
    qrTokenCallCount += 1;
    qrTokenCallIds.push(params.id as string);
    if (qrTokenDelayMs) await delay(qrTokenDelayMs);
    if (qrTokenStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: qrTokenStatus });
    }
    qrTokenCounter += 1;
    return HttpResponse.json({
      qr_token: `QR_generated_${qrTokenCounter}`,
      user_id: params.id as string,
      email: "alice@example.com",
    });
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(zonesResponse)),
  http.get("http://api.test/api/users/:userId/zones", () => HttpResponse.json(userZonesResponse)),
  http.delete("http://api.test/api/events/:eventId/staff/:userId", async ({ params }) => {
    revokeCalls.push({ eventId: params.eventId as string, userId: params.userId as string });
    if (revokeDelayMs) await delay(revokeDelayMs);
    if (revokeStatus !== 204) return HttpResponse.json({ error: "revoke-boom" }, { status: revokeStatus });
    return new HttpResponse(null, { status: 204 });
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

function renderCard(overrides: Partial<StaffCardProps> = {}) {
  const props: StaffCardProps = {
    user: staffUser(),
    zoneNames: [],
    eventId: "evt-1",
    isAdmin: true,
    canManage: true,
    cachedToken: undefined,
    onTokenCached: vi.fn(),
    onOpenPrintSheet: vi.fn(),
    disabled: false,
    ...overrides,
  };
  return { props, ...renderWithProviders(<StaffCard {...props} />) };
}

describe("StaffCard — QR area + print flow", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    qrTokenCallCount = 0;
    qrTokenCallIds = [];
    qrTokenStatus = 200;
    qrTokenDelayMs = 0;
    qrTokenCounter = 0;
    zonesResponse = [];
    userZonesResponse = [];
    revokeCalls = [];
    revokeStatus = 200;
    revokeDelayMs = 0;
  });

  describe("QR area states (admin)", () => {
    it("cached token: renders a live QrSvg + the zones caption + the issued/valid-30-days line from qr_token_created_at (local time)", async () => {
      renderCard({
        user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-15T10:30:00Z" }),
        zoneNames: ["Main hall", "VIP"],
        cachedToken: "QR_cached_token",
      });

      expect(await screen.findByRole("img", { name: "QR login code for alice@example.com" })).toBeInTheDocument();
      // Appears twice by design: once in the card's own top-level zones
      // line (unchanged since Task 5), once again inside the QR card visual
      // itself (task brief: "reusing the zones caption") — the printed
      // physical card has no access to that top-level line at all, so the
      // QR area's own copy is what actually reaches the print sheet.
      expect(screen.getAllByText("QR login · zones: Main hall, VIP")).toHaveLength(2);
      const expectedDate = new Intl.DateTimeFormat("en", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(new Date("2026-01-15T10:30:00Z"));
      expect(screen.getByText(`Issued ${expectedDate} · valid 30 days`)).toBeInTheDocument();
    });

    it("has_qr_token but not cached: shows the muted 'can't be re-displayed' box with the issued date, no QrSvg", async () => {
      renderCard({
        user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-15T10:30:00Z" }),
        cachedToken: undefined,
      });

      const expectedDate = new Intl.DateTimeFormat("en", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(new Date("2026-01-15T10:30:00Z"));
      expect(
        await screen.findByText(`QR was issued ${expectedDate}. Codes can't be re-displayed — printing issues a new one.`),
      ).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("never issued: shows the dashed 'no QR yet' box with a Generate button", async () => {
      renderCard({ user: staffUser({ has_qr_token: false }), cachedToken: undefined });

      expect(await screen.findByText("No QR login yet")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    });
  });

  describe("Generate (never-issued state)", () => {
    it("generates with no confirm dialog, caches the token via onTokenCached, and does NOT open the print sheet", async () => {
      const user = userEvent.setup();
      const onTokenCached = vi.fn();
      const onOpenPrintSheet = vi.fn();
      renderCard({
        user: staffUser({ id: "u9", has_qr_token: false }), onTokenCached, onOpenPrintSheet,
      });

      await user.click(screen.getByRole("button", { name: "Generate" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(onTokenCached).toHaveBeenCalledWith("u9", "QR_generated_1"));
      expect(onOpenPrintSheet).not.toHaveBeenCalled();
      expect(qrTokenCallIds).toEqual(["u9"]);
    });
  });

  // P2.1's "silent failure" bug class, reopened for the two confirm-less
  // generate paths: the dashed-box Generate button and never-issued "Print
  // card" both call runGenerate with no ConfirmDialog ever mounted, so
  // generateToken.isError (previously only ever read inside that dialog's
  // own description) had nowhere to render — the button just re-enabled
  // with nothing shown.
  describe("Silent-failure surfacing on confirm-less generate paths", () => {
    it("dashed-box Generate: a failed mutation shows the inline staffRegenerateError line on the card itself", async () => {
      qrTokenStatus = 500;
      const user = userEvent.setup();
      renderCard({ user: staffUser({ has_qr_token: false }) });

      await user.click(screen.getByRole("button", { name: "Generate" }));

      expect(await screen.findByText("Couldn't generate the QR code. Try again.")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("never-issued 'Print card': a failed mutation (no confirm dialog) shows the same inline error", async () => {
      qrTokenStatus = 500;
      const user = userEvent.setup();
      renderCard({ user: staffUser({ has_qr_token: false }) });

      await user.click(await screen.findByRole("button", { name: "Print card" }));

      expect(await screen.findByText("Couldn't generate the QR code. Try again.")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does not double-render the error when the regenerate confirm dialog IS open — it stays inside the dialog only", async () => {
      qrTokenStatus = 500;
      const user = userEvent.setup();
      renderCard({ user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }) });

      await user.click(await screen.findByRole("button", { name: "Print card" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print card" }));

      expect(await within(dialog).findByText("Couldn't generate the QR code. Try again.")).toBeInTheDocument();
      expect(screen.getAllByText("Couldn't generate the QR code. Try again.")).toHaveLength(1);
    });
  });

  describe("Print flow", () => {
    it("cached token: 'Print card' opens the sheet directly with no network call and no confirm", async () => {
      const user = userEvent.setup();
      const onOpenPrintSheet = vi.fn();
      renderCard({
        user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }),
        zoneNames: ["Main hall"],
        cachedToken: "QR_cached",
        onOpenPrintSheet,
      });

      await user.click(await screen.findByRole("button", { name: "Print card" }));

      expect(onOpenPrintSheet).toHaveBeenCalledWith({
        email: "alice@example.com", roleLabel: "Staff", zonesCaption: "QR login · zones: Main hall", token: "QR_cached",
      });
      expect(qrTokenCallCount).toBe(0);
    });

    it("has_qr_token && not cached: 'Print card' opens a tier-1 confirm dialog first", async () => {
      const user = userEvent.setup();
      renderCard({ user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }) });

      await user.click(await screen.findByRole("button", { name: "Print card" }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Regenerate QR code?")).toBeInTheDocument();
      expect(screen.getByText("A new code is issued — the previously printed card stops working.")).toBeInTheDocument();
      expect(qrTokenCallCount).toBe(0);
    });

    it("confirming the regenerate dialog mutates, caches the token, closes the dialog, and opens the sheet", async () => {
      const user = userEvent.setup();
      const onTokenCached = vi.fn();
      const onOpenPrintSheet = vi.fn();
      renderCard({
        user: staffUser({ id: "u2", has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }),
        onTokenCached,
        onOpenPrintSheet,
      });

      await user.click(await screen.findByRole("button", { name: "Print card" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print card" }));

      await waitFor(() => expect(onTokenCached).toHaveBeenCalledWith("u2", "QR_generated_1"));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onOpenPrintSheet).toHaveBeenCalledWith(
        expect.objectContaining({ token: "QR_generated_1" }),
      );
    });

    it("mutation failure keeps the confirm dialog open and shows an inline error", async () => {
      qrTokenStatus = 500;
      const user = userEvent.setup();
      renderCard({ user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }) });

      await user.click(await screen.findByRole("button", { name: "Print card" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print card" }));

      expect(await within(dialog).findByText("Couldn't generate the QR code. Try again.")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("never issued: 'Print card' generates with no confirm and opens the sheet on success", async () => {
      const user = userEvent.setup();
      const onOpenPrintSheet = vi.fn();
      renderCard({ user: staffUser({ id: "u3", has_qr_token: false }), onOpenPrintSheet });

      await user.click(await screen.findByRole("button", { name: "Print card" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(onOpenPrintSheet).toHaveBeenCalledWith(
        expect.objectContaining({ token: "QR_generated_1" }),
      ));
    });

    // Finding 2 (final review): zoneNames === "error" is an unverifiable
    // state — the on-screen caption is allowed to say so (staffZonesError),
    // but baking that literal error copy onto a PRINTED physical card would
    // read as if it were a real, factual zone list. The printed card must
    // omit the zones segment instead (minimal honest rendering).
    it("zoneNames === 'error': the printed card omits the zones segment instead of baking in the error copy", async () => {
      const user = userEvent.setup();
      const onOpenPrintSheet = vi.fn();
      renderCard({
        user: staffUser({ id: "u5", has_qr_token: false }), zoneNames: "error", onOpenPrintSheet,
      });

      await user.click(await screen.findByRole("button", { name: "Print card" }));

      await waitFor(() => expect(onOpenPrintSheet).toHaveBeenCalledWith(
        expect.objectContaining({ zonesCaption: "" }),
      ));
    });

    it("session-ref cancel race: closing the confirm dialog mid-flight still caches the token (unconditional) but never opens the sheet", async () => {
      qrTokenDelayMs = 40;
      const user = userEvent.setup();
      const onTokenCached = vi.fn();
      const onOpenPrintSheet = vi.fn();
      renderCard({
        user: staffUser({ id: "u4", has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }),
        onTokenCached,
        onOpenPrintSheet,
      });

      await user.click(await screen.findByRole("button", { name: "Print card" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Print card" }));

      // Back out of the dialog WHILE the (delayed) mutation is still in
      // flight — unlike AddAttendeeDialog's form-entry dialogs, this is not
      // blocked: there's no in-progress data entry to protect, just a
      // single fire-and-forget regenerate the user can walk away from.
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await waitFor(() => expect(onTokenCached).toHaveBeenCalledWith("u4", "QR_generated_1"));
      // Give the resolved promise's callback a moment to (not) call this.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onOpenPrintSheet).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("non-admin gating", () => {
    it("manager: Generate is disabled with the admin-only tooltip", async () => {
      renderCard({
        user: staffUser({ has_qr_token: false }), isAdmin: false, canManage: true,
      });

      const generateButton = await screen.findByRole("button", { name: "Generate" });
      expect(generateButton).toBeDisabled();
      expect(generateButton).toHaveAttribute("title", "Only admins can generate or print QR codes.");
    });

    it("manager: Print card (visible via canManage) is disabled with the admin-only tooltip", async () => {
      renderCard({
        user: staffUser({ has_qr_token: true, qr_token_created_at: "2026-01-01T00:00:00Z" }),
        isAdmin: false,
        canManage: true,
      });

      const printButton = await screen.findByRole("button", { name: "Print card" });
      expect(printButton).toBeDisabled();
      expect(printButton).toHaveAttribute("title", "Only admins can generate or print QR codes.");
    });

    it("staff role: action row is absent, but Generate in the QR area is still disabled with the tooltip", async () => {
      renderCard({
        user: staffUser({ has_qr_token: false }), isAdmin: false, canManage: false,
      });

      expect(screen.queryByRole("button", { name: "Print card" })).not.toBeInTheDocument();
      const generateButton = await screen.findByRole("button", { name: "Generate" });
      expect(generateButton).toBeDisabled();
    });
  });

  describe("page-level busy gating", () => {
    it("disables Generate/Print while a page-level bulk operation (Print all) is running, even for an admin", async () => {
      renderCard({ user: staffUser({ has_qr_token: false }), disabled: true });

      expect(await screen.findByRole("button", { name: "Generate" })).toBeDisabled();
    });
  });

  describe("Zones action", () => {
    it("Zones is enabled for canManage (admin or manager) and opens the StaffZonesDialog for this exact user", async () => {
      zonesResponse = [
        { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: true, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
      ];
      userZonesResponse = [];
      const user = userEvent.setup();
      renderCard({ user: staffUser({ id: "u1", email: "alice@example.com" }), isAdmin: false, canManage: true });

      const zonesButton = screen.getByRole("button", { name: "Zones" });
      expect(zonesButton).toBeEnabled();
      await user.click(zonesButton);

      expect(await screen.findByText("Zone access for alice@example.com")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Main hall" })).toBeInTheDocument();
    });
  });

  describe("Revoke action", () => {
    it("opens a tier-1 confirm with the exact copy (email interpolated)", async () => {
      const user = userEvent.setup();
      renderCard({ user: staffUser({ email: "bob@example.com" }) });

      await user.click(screen.getByRole("button", { name: "Revoke…" }));

      expect(await screen.findByText("Revoke access?")).toBeInTheDocument();
      expect(
        screen.getByText("bob@example.com loses event-day access to this event. You can re-add them anytime."),
      ).toBeInTheDocument();
      expect(revokeCalls).toHaveLength(0);
    });

    it("confirming DELETEs /api/events/{event_id}/staff/{user_id} and invalidates STAFF_KEY(eventId) on success", async () => {
      const user = userEvent.setup();
      const { queryClient } = renderCard({
        user: staffUser({ id: "u7", email: "bob@example.com" }), eventId: "evt-9",
      });
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(screen.getByRole("button", { name: "Revoke…" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

      await waitFor(() => expect(revokeCalls).toEqual([{ eventId: "evt-9", userId: "u7" }]));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["get", "/api/events/{event_id}/staff", { params: { path: { event_id: "evt-9" } } }],
        }),
      );
      // Revoke must never invalidate this user's zones query — that would
      // be pointless error noise for a row that's about to disappear from
      // the list, not a real cache-correctness need (task brief).
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["get", "/api/users/{user_id}/zones", { params: { path: { user_id: "u7" } } }],
        }),
      );
    });

    it("keeps the confirm dialog open and shows an inline error on failure", async () => {
      revokeStatus = 500;
      const user = userEvent.setup();
      renderCard({ user: staffUser({ email: "bob@example.com" }) });

      await user.click(screen.getByRole("button", { name: "Revoke…" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

      expect(await within(dialog).findByText("Couldn't revoke access. Try again.")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("session-ref: closing the confirm mid-flight still invalidates unconditionally but doesn't reopen a stale dialog state", async () => {
      revokeDelayMs = 40;
      const user = userEvent.setup();
      const { queryClient } = renderCard({ user: staffUser({ id: "u8", email: "bob@example.com" }) });
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(screen.getByRole("button", { name: "Revoke…" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
      // Not blocked (fire-and-forget, same as regenerate) — back out while
      // the DELETE is still in flight.
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await waitFor(() => expect(revokeCalls).toHaveLength(1));
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: ["get", "/api/events/{event_id}/staff", { params: { path: { event_id: "evt-1" } } }],
          }),
        ),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
