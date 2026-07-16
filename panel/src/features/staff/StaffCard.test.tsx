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
    onZones: vi.fn(),
    onRevoke: vi.fn(),
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
});
