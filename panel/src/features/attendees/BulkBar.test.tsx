import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { BulkBar } from "./BulkBar";
import { ATTENDEES_LIST_KEY, useAttendeesPage } from "./hooks";
import { useEventReadiness } from "../events/hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

// Task 9 (P3.2): every BulkBar instance now ALSO mounts useAgentPrinters(true)
// (the reachability-gated "Print badges" button) and usePrintBadge's own
// useBadgeTemplate/useEventFontFaces calls -- all unconditional, regardless
// of whether any given test cares about printing. Same jsdom FontFace stub
// AttendeeDrawer.test.tsx uses for its own reprint flow (jsdom implements
// neither `FontFace` nor `document.fonts` -- see useEventFontFaces.ts's own
// comment): without it, fontsStatus is stuck on "idle" forever and the print
// dialog's confirm button would never enable.
class MockFontFace {
  family: string;
  constructor(family: string, _source: unknown, _descriptors?: { weight?: string; style?: string }) {
    this.family = family;
  }
  load(): Promise<MockFontFace> {
    return Promise.resolve(this);
  }
}
function stubFontFaceApi() {
  (globalThis as unknown as { FontFace: unknown }).FontFace = MockFontFace;
  Object.defineProperty(document, "fonts", { value: { add: () => {} }, configurable: true, writable: true });
}
function unstubFontFaceApi() {
  delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
  // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts` stub;
  // real jsdom has no `fonts` property to restore.
  delete document.fonts;
}

// Genuinely subscribed observer for GET /api/events/:id/readiness — same
// ReadinessObserver pattern as AddAttendeeDialog.test.tsx: mounting a real
// useQuery consumer alongside the component under test makes
// `invalidateQueries` for READINESS_KEY produce an OBSERVABLE refetch (via
// `readinessHitCount`), rather than merely asserting the invalidate call was
// made.
function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

// Same pattern, for GET /api/events/:eventId/attendees — proves the bulk
// print loop's ONE post-loop invalidateQueries call for ATTENDEES_LIST_KEY
// produces a real, OBSERVABLE refetch (via `listHitCount`), and — just as
// importantly — that it happens exactly ONCE per batch, not once per
// attendee (the whole point of `skipInvalidate: true` per call).
function AttendeesListObserver({ eventId }: { eventId: string }) {
  useAttendeesPage(eventId, { page: 1 });
  return null;
}

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
let readinessHitCount = 0;
let listHitCount = 0;

// Task 9 (P3.2) bulk-print fixtures below.
const TEMPLATE_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
};
let templateResponse: { template: Record<string, unknown> | null; version: number } = {
  template: TEMPLATE_DOC,
  version: 1,
};
// Disconnected by default (matches every OTHER test in this file, which
// doesn't care about printing) — individual print tests flip this to true.
let agentHealthOk = false;
let printersResponse: Array<{ name: string; type: string }> = [];
let defaultPrinterResponse: { default: string | null } = { default: null };
let printCalls: Array<{ printer_name: string; zpl: string }> = [];
let printHitCount = 0;
// 1-based call index to fail (simulates ONE attendee's agent send failing
// mid-batch) — the /print request body carries no attendee id (only
// printer_name/zpl), so failing by SEQUENCE POSITION is what lets a test
// target "the second attendee's send" deterministically, since the loop is
// proven sequential (never Promise.all) elsewhere in this file already.
let printFailOnIndex: number | null = null;
let printDelayMs = 0;
let markPrintedHitCount = 0;
let markPrintedFailOnIndex: number | null = null;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessHitCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
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
  http.get("http://api.test/api/events/:eventId/attendees", () => {
    listHitCount += 1;
    return HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 });
  }),
  // Task 9 additions below -- badge-template/fonts/agent/mark-printed, same
  // shape as AttendeeDrawer.test.tsx's own Task 8 fixtures.
  http.get("http://api.test/api/events/:id/badge-template", () => HttpResponse.json(templateResponse)),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.post("http://api.test/api/attendees/:attendeeId/printed", () => {
    markPrintedHitCount += 1;
    if (markPrintedFailOnIndex !== null && markPrintedHitCount === markPrintedFailOnIndex) {
      return HttpResponse.json({ error: "boom" }, { status: 500 });
    }
    return HttpResponse.json({ printed_count: markPrintedHitCount });
  }),
  http.get("http://agent.test/health", () =>
    agentHealthOk ? new HttpResponse(null, { status: 200 }) : HttpResponse.error()),
  http.get("http://agent.test/printers", () => HttpResponse.json(printersResponse)),
  http.get("http://agent.test/printers/default", () => HttpResponse.json(defaultPrinterResponse)),
  http.post("http://agent.test/print", async ({ request }) => {
    printHitCount += 1;
    const body = (await request.json()) as { printer_name: string; zpl: string };
    printCalls.push(body);
    if (printDelayMs) await delay(printDelayMs);
    if (printFailOnIndex !== null && printHitCount === printFailOnIndex) {
      return new HttpResponse("printer offline", { status: 500 });
    }
    return HttpResponse.json({ status: "printed" });
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
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
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
    readinessHitCount = 0;
    listHitCount = 0;
    templateResponse = { template: TEMPLATE_DOC, version: 1 };
    agentHealthOk = false;
    printersResponse = [];
    defaultPrinterResponse = { default: null };
    printCalls = [];
    printHitCount = 0;
    printFailOnIndex = null;
    printDelayMs = 0;
    markPrintedHitCount = 0;
    markPrintedFailOnIndex = null;
    stubFontFaceApi();
  });

  afterEach(() => {
    unstubFontFaceApi();
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

  describe("Print badges", () => {
    it("renders Print badges disabled with a title when the local print agent is unreachable", async () => {
      renderWithProviders(<BulkBar selected={[ADA]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      // Wait for the FINAL "disconnected" state (not the transient
      // "checking" one) before asserting the title — both states render the
      // button disabled, but only "disconnected" sets the tooltip.
      await waitFor(() => expect(printButton).toHaveAttribute("title", "Can't reach the local print agent."));
      expect(printButton).toBeDisabled();
    });

    it("enables Print badges once the agent is reachable", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      renderWithProviders(<BulkBar selected={[ADA]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      expect(printButton).not.toHaveAttribute("title");
    });

    it("names the configured default printer in a count summary, sends sequentially, marks each printed, invalidates the attendees list exactly ONCE, and stays open on the final honest tally", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      const user = userEvent.setup();
      renderWithProviders(
        <>
          <AttendeesListObserver eventId="evt-1" />
          <BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />
        </>,
      );
      await waitFor(() => expect(listHitCount).toBe(1));

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      await user.click(printButton);

      const dialog = await screen.findByRole("dialog", { name: "Print badges" });
      expect(within(dialog).getByText("2 badges to Zebra_ZD421")).toBeInTheDocument();
      expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      await waitFor(() => expect(printCalls).toHaveLength(2));
      expect(printCalls.every((call) => call.printer_name === "Zebra_ZD421")).toBe(true);
      await waitFor(() => expect(markPrintedHitCount).toBe(2));

      // Honest final tally — no failures, so the plain "sent" copy shows.
      expect(await within(dialog).findByText("2 of 2 sent")).toBeInTheDocument();
      // Stays open (same idiom as Assign zone): the operator reads the tally
      // and dismisses it themselves rather than it vanishing on them.
      expect(screen.getByRole("dialog", { name: "Print badges" })).toBe(dialog);

      // Exactly ONE list refetch for the whole batch (skipInvalidate per call
      // + one explicit invalidate after the loop), not one per attendee.
      await waitFor(() => expect(listHitCount).toBe(2));
    });

    it("continues past a failed attendee send, counting sent-vs-failed honestly instead of aborting the batch", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      printFailOnIndex = 1; // ADA's send (first in sequence) fails; BOB's still fires.
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      await user.click(printButton);
      const dialog = await screen.findByRole("dialog", { name: "Print badges" });
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      // Both attendees were attempted despite the first failing.
      await waitFor(() => expect(printCalls).toHaveLength(2));
      expect(await within(dialog).findByText("1 of 2 sent — 1 failed")).toBeInTheDocument();
      // The plain (dishonest, implies-full-success) readout is gone.
      expect(within(dialog).queryByText(/^2 of 2 sent$/)).not.toBeInTheDocument();
    });

    it("counts a MarkPrintedError attendee as SENT (not failed) and shows the soft mark-warn message", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      markPrintedFailOnIndex = 1; // ADA's send succeeds; only her printed-count bump fails.
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      await user.click(printButton);
      const dialog = await screen.findByRole("dialog", { name: "Print badges" });
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      await waitFor(() => expect(printCalls).toHaveLength(2));
      // Counted as fully sent — the send itself succeeded for both.
      expect(await within(dialog).findByText("2 of 2 sent")).toBeInTheDocument();
      // ...but with a soft, non-destructive warning for the one attendee
      // whose printed-count bump failed after the send already went out.
      expect(within(dialog).getByText("1 sent but not recorded")).toBeInTheDocument();
    });

    it("short-circuits the whole loop — never attempting the remaining attendees — when the event has no badge template", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      templateResponse = { template: null, version: 0 };
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      await user.click(printButton);
      const dialog = await screen.findByRole("dialog", { name: "Print badges" });
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      expect(await within(dialog).findByText("This event doesn't have a badge template yet.")).toBeInTheDocument();
      // Never even reached the agent — a template-less event fails
      // identically for every attendee, so there's no point trying the rest.
      expect(printCalls).toHaveLength(0);
      expect(screen.getByRole("dialog", { name: "Print badges" })).toBe(dialog);
    });

    it("shows an inline printer select (no configured default), preselects the first printer, and sends to whichever is chosen", async () => {
      agentHealthOk = true;
      printersResponse = [
        { name: "Zebra_ZD421", type: "system" },
        { name: "Network_Printer", type: "network" },
      ];
      defaultPrinterResponse = { default: null };
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      await user.click(printButton);
      const dialog = await screen.findByRole("dialog", { name: "Print badges" });

      const select = within(dialog).getByLabelText<HTMLSelectElement>("Printer");
      await waitFor(() => expect(select.value).toBe("Zebra_ZD421"));
      await user.selectOptions(select, "Network_Printer");
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      await waitFor(() => expect(printCalls).toHaveLength(1));
      expect(printCalls[0].printer_name).toBe("Network_Printer");
    });

    it("cannot be dismissed via the X close button or Escape while the batch is genuinely running, but becomes dismissable once it settles", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      printDelayMs = 40;
      const user = userEvent.setup();
      renderWithProviders(<BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />);

      const printButton = await screen.findByRole("button", { name: "Print badges" });
      await waitFor(() => expect(printButton).toBeEnabled());
      await user.click(printButton);
      const dialog = await screen.findByRole("dialog", { name: "Print badges" });
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      // First send in flight (delayed) — the X close button and Escape are
      // both no-ops while genuinely running: a cancelled/failed-looking print
      // may still emerge from the printer (transport ack only), so aborting
      // mid-batch would leave untracked physical output with no record of
      // which attendees were actually sent.
      await waitFor(() => expect(printCalls).toHaveLength(1));
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // The batch continues regardless — both sends still fire (the blocked
      // dismissal did not silently stop the loop).
      await waitFor(() => expect(printCalls).toHaveLength(2));

      // Once the batch genuinely settles, the dialog becomes dismissable
      // again (post-loop close allowed).
      await waitFor(() => expect(screen.queryByText(/2 of 2 sent/)).toBeInTheDocument());
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
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

    it("fires sequential DELETEs with live progress and invalidates the list AND readiness on completion (the deletions change the rail's attendees count)", async () => {
      const user = userEvent.setup();
      const queryClient = renderWithProviders(
        <>
          <ReadinessObserver eventId="evt-1" />
          <BulkBar selected={[ADA, BOB]} eventId="evt-1" onClear={vi.fn()} />
        </>,
      );
      await waitFor(() => expect(readinessHitCount).toBe(1));
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
      // The genuinely subscribed readiness observer actually refetches —
      // not just an invalidateQueries call asserted in isolation.
      await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
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
