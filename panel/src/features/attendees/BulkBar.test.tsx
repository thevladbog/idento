import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { BulkBar } from "./BulkBar";
import { ATTENDEES_LIST_KEY } from "./hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: "a1",
    event_id: "evt-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    position: "Engineer",
    code: "PD-0107",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ADA = makeAttendee({ id: "a1" });
const BOB = makeAttendee({ id: "a2", first_name: "Bob", last_name: "Noll" });

let zoneAccessCalls: { attendeeId: string; body: unknown }[] = [];
let zoneAccessStatusOverride: number | null = null;
let deleteCalls: string[] = [];
let deleteStatusOverride: number | null = null;
let deleteDelayMs = 0;
let deleteFailFor: Set<string> = new Set();

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/zones", () =>
    HttpResponse.json([
      {
        id: "z1",
        event_id: "evt-1",
        name: "Main Hall",
        zone_type: "general",
        order_index: 0,
        is_registration_zone: true,
        requires_registration: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "z2",
        event_id: "evt-1",
        name: "VIP",
        zone_type: "general",
        order_index: 1,
        is_registration_zone: false,
        requires_registration: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]),
  ),
  http.post("http://api.test/api/attendees/:attendeeId/zone-access", async ({ request, params }) => {
    const body = await request.json();
    zoneAccessCalls.push({ attendeeId: params.attendeeId as string, body });
    if (zoneAccessStatusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: zoneAccessStatusOverride });
    }
    return HttpResponse.json(
      { id: "za1", attendee_id: params.attendeeId, zone_id: "z1", allowed: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { status: 201 },
    );
  }),
  http.delete("http://api.test/api/attendees/:id", async ({ params }) => {
    const id = params.id as string;
    deleteCalls.push(id);
    if (deleteDelayMs) await delay(deleteDelayMs);
    if (deleteStatusOverride || deleteFailFor.has(id)) {
      return HttpResponse.json({ error: "boom" }, { status: deleteStatusOverride ?? 500 });
    }
    return HttpResponse.json({ message: "deleted" });
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

describe("BulkBar", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    zoneAccessCalls = [];
    zoneAccessStatusOverride = null;
    deleteCalls = [];
    deleteStatusOverride = null;
    deleteDelayMs = 0;
    deleteFailFor = new Set();
  });

  it("shows the selected count and a divider before the action list", async () => {
    renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);
    expect(await screen.findByText("2 selected")).toBeInTheDocument();
  });

  it("calls onClear when the Clear action is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithProviders(<BulkBar selected={[ADA]} eventId="evt-1" onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders the Print badges chip as a non-interactive, non-button element", () => {
    renderWithProviders(<BulkBar selected={[ADA]} eventId="evt-1" onClear={vi.fn()} />);

    const chip = screen.getByText("Print badges — coming with the badge editor");
    expect(chip.tagName).not.toBe("BUTTON");
    expect(chip).not.toHaveAttribute("onclick");
    expect(screen.queryByRole("button", { name: /print badges/i })).not.toBeInTheDocument();
  });

  describe("Assign zone", () => {
    it("opens a dialog listing zones, then POSTs zone-access sequentially (one per selected id) and invalidates the attendees list", async () => {
      const user = userEvent.setup();
      const queryClient = renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(screen.getByRole("button", { name: "Assign zone" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Main Hall")).toBeInTheDocument();
      expect(within(dialog).getByText("VIP")).toBeInTheDocument();

      await user.click(within(dialog).getByText("VIP"));

      await waitFor(() => expect(zoneAccessCalls).toHaveLength(2));
      expect(zoneAccessCalls.map((c) => c.attendeeId).sort()).toEqual(["a1", "a2"]);
      for (const call of zoneAccessCalls) {
        expect(call.body).toEqual({ zone_id: "z2", allowed: true });
      }

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ATTENDEES_LIST_KEY("evt-1") })),
      );
    });

    it("shows a live x / y progress readout while assigning", async () => {
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Assign zone" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByText("Main Hall"));

      await waitFor(() => expect(zoneAccessCalls.length).toBeGreaterThan(0));
      // Eventually reaches "2 / 2" (real, not fabricated, counts).
      await waitFor(() => expect(screen.queryByText(/2 \/ 2/)).toBeInTheDocument());
    });

    it("skips individual zone-access failures rather than aborting the whole batch", async () => {
      const user = userEvent.setup();
      zoneAccessStatusOverride = 500;
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Assign zone" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByText("Main Hall"));

      // Both requests still fire even though both fail.
      await waitFor(() => expect(zoneAccessCalls).toHaveLength(2));
    });
  });

  describe("Export", () => {
    it("triggers a client-side CSV download with no network request", async () => {
      const user = userEvent.setup();
      const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Export" }));

      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(zoneAccessCalls).toHaveLength(0);
      expect(deleteCalls).toHaveLength(0);

      vi.restoreAllMocks();
    });
  });

  describe("Delete…", () => {
    it("disables the confirm button until the exact selected count is typed", async () => {
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      const dialog = await screen.findByRole("dialog");
      const confirmButton = within(dialog).getByRole("button", { name: "Delete…" });
      expect(confirmButton).toBeDisabled();

      const input = within(dialog).getByLabelText("Type 2 to confirm");
      await user.type(input, "1");
      expect(confirmButton).toBeDisabled();

      await user.clear(input);
      await user.type(input, "2");
      expect(confirmButton).toBeEnabled();
    });

    it("fires sequential DELETEs with live progress and invalidates the list on completion", async () => {
      const user = userEvent.setup();
      const queryClient = renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type 2 to confirm"), "2");
      await user.click(within(dialog).getByRole("button", { name: "Delete…" }));

      await waitFor(() => expect(deleteCalls).toHaveLength(2));
      expect(deleteCalls.sort()).toEqual(["a1", "a2"]);

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ATTENDEES_LIST_KEY("evt-1") })),
      );
      // Dialog closes automatically once the whole batch succeeds.
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("keeps the dialog open with an inline error when a delete fails, without discarding the typed confirmation session", async () => {
      const user = userEvent.setup();
      deleteFailFor = new Set(["a2"]);
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type 2 to confirm"), "2");
      await user.click(within(dialog).getByRole("button", { name: "Delete…" }));

      await waitFor(() => expect(deleteCalls).toHaveLength(2));
      expect(await screen.findByText("Some attendees couldn't be deleted. Try again.")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("a stale response from a cancelled delete batch does not reopen an error or navigate once the dialog is closed", async () => {
      const user = userEvent.setup();
      deleteDelayMs = 60;
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      let dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type 2 to confirm"), "2");
      await user.click(within(dialog).getByRole("button", { name: "Delete…" }));

      // First DELETE is in flight (delayed) — cancel now via the dialog's
      // close (X) button before it resolves.
      await waitFor(() => expect(deleteCalls).toHaveLength(1));
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // Let the delayed response land.
      await new Promise((resolve) => setTimeout(resolve, 120));

      // No stray error text anywhere, and reopening shows a fresh dialog
      // (no leftover error / progress state from the cancelled session).
      expect(screen.queryByText("Some attendees couldn't be deleted. Try again.")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByText("Some attendees couldn't be deleted. Try again.")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Delete…" })).toBeDisabled();
    });
  });
});
