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
let zoneAccessFailFor: Set<string> = new Set();
let zoneAccessDelayMs = 0;
// In-flight tracking for Fix 6: proves the zone-access POSTs are genuinely
// SEQUENTIAL (never Promise.all-style concurrent) at the network level, not
// just that they eventually all fire — a batch that fired everything
// concurrently would still pass the old assertions (same ids, same bodies,
// same final invalidation) while violating the "one at a time" contract the
// component's own comments and Fix 6's task brief require.
let zoneAccessInFlight = 0;
let zoneAccessMaxInFlight = 0;
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
    zoneAccessInFlight += 1;
    zoneAccessMaxInFlight = Math.max(zoneAccessMaxInFlight, zoneAccessInFlight);
    const body = await request.json();
    zoneAccessCalls.push({ attendeeId: params.attendeeId as string, body });
    if (zoneAccessDelayMs) await delay(zoneAccessDelayMs);
    zoneAccessInFlight -= 1;
    const attendeeId = params.attendeeId as string;
    if (zoneAccessStatusOverride || zoneAccessFailFor.has(attendeeId)) {
      return HttpResponse.json({ error: "boom" }, { status: zoneAccessStatusOverride ?? 500 });
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
    zoneAccessFailFor = new Set();
    zoneAccessDelayMs = 0;
    zoneAccessInFlight = 0;
    zoneAccessMaxInFlight = 0;
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
    it("opens a dialog listing zones, then POSTs zone-access strictly sequentially (one in flight at a time, one per selected id) and invalidates the attendees list", async () => {
      const user = userEvent.setup();
      // Delaying each response is what makes "sequential, not Promise.all"
      // an observable, testable claim: with an instant response, a
      // concurrent (Promise.all-style) implementation and a sequential one
      // both produce the exact same call log, so max-in-flight would always
      // read 1 by accident rather than by proof. The delay creates a window
      // where a concurrent implementation's second request would overlap
      // the first, which the max-in-flight counter below would catch.
      zoneAccessDelayMs = 30;
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

      // The whole batch never had more than 1 request in flight at once —
      // proof of strict sequential execution, not just eventual completion.
      expect(zoneAccessMaxInFlight).toBe(1);
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

    it("shows an honest success/failure breakdown once the batch settles with some failures, instead of implying full success", async () => {
      const user = userEvent.setup();
      zoneAccessFailFor = new Set(["a2"]);
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Assign zone" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByText("Main Hall"));

      await waitFor(() => expect(zoneAccessCalls).toHaveLength(2));
      expect(await screen.findByText("1 of 2 assigned — 1 failed")).toBeInTheDocument();
      // The plain (dishonest, implies-full-success) "x / y" readout is gone
      // once the honest breakdown is showing.
      expect(screen.queryByText(/^2 \/ 2$/)).not.toBeInTheDocument();
    });

    it("cannot be dismissed via the X close button, Escape, or Cancel while the assign batch is genuinely running", async () => {
      const user = userEvent.setup();
      zoneAccessDelayMs = 60;
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Assign zone" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByText("Main Hall"));

      // First request in flight — the X close button is hidden entirely
      // (hideClose while isAssigning), and Escape is a no-op.
      await waitFor(() => expect(zoneAccessCalls).toHaveLength(1));
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Still open and still running once the second request fires too.
      await waitFor(() => expect(zoneAccessCalls).toHaveLength(2));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Once the batch genuinely completes, the X button reappears and the
      // dialog becomes dismissable again.
      await waitFor(() => expect(screen.queryByText(/2 \/ 2/)).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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

    it("cannot be dismissed via the X close button or Escape while the delete batch is genuinely running", async () => {
      const user = userEvent.setup();
      deleteDelayMs = 60;
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type 2 to confirm"), "2");
      await user.click(within(dialog).getByRole("button", { name: "Delete…" }));

      // First DELETE is in flight (delayed) — attempt to dismiss via the X
      // close button and Escape; both must be no-ops while the batch is
      // genuinely running (Fix 3: a batch delete must not be silently
      // abandonable mid-way, which would leave some attendees deleted and
      // some not with no record of which).
      await waitFor(() => expect(deleteCalls).toHaveLength(1));
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // The batch continues to completion regardless — both DELETEs still
      // fire (the blocked dismissal did not silently stop the loop).
      await waitFor(() => expect(deleteCalls).toHaveLength(2));
    });

    it("a stale response from a cancelled-after-completion delete session does not reopen an error or leak into a freshly reopened dialog", async () => {
      const user = userEvent.setup();
      deleteFailFor = new Set(["a2"]);
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      let dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type 2 to confirm"), "2");
      await user.click(within(dialog).getByRole("button", { name: "Delete…" }));

      // Batch settles (with a failure) — only NOW, once it's no longer
      // genuinely running, can the dialog actually be dismissed.
      await waitFor(() => expect(deleteCalls).toHaveLength(2));
      expect(await screen.findByText("Some attendees couldn't be deleted. Try again.")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // No stray error text anywhere, and reopening shows a fresh dialog
      // (no leftover error / progress state from the previous session).
      expect(screen.queryByText("Some attendees couldn't be deleted. Try again.")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Delete…" }));
      dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByText("Some attendees couldn't be deleted. Try again.")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Delete…" })).toBeDisabled();
    });
  });
});
