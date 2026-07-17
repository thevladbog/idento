// P4.1 Task 9 -- the check-in station's recent-scans rail. Fills
// StationPage.tsx's placeholder aside (Task 8) with the last-50
// checkin-actions feed and its per-row Reprint/Undo/Details actions.
//
// Every test in this file mounts usePrintBadge's own useBadgeTemplate/
// useEventFontFaces calls AND useAgentPrinters(true) unconditionally
// (same rationale as AttendeeDrawer.test.tsx's own top-of-file comment --
// RecentScansRail's Reprint action is built on the exact same P3.2
// usePrintBadge pipeline), so every test needs those endpoints mocked
// regardless of whether it exercises printing.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { RecentScansRail } from "./RecentScansRail";
import { useAttendeesPage } from "../attendees/hooks";
import { agentClient, AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type CheckinActionRow = components["schemas"]["CheckinActionRow"];
type Attendee = components["schemas"]["Attendee"];

// jsdom implements neither `FontFace` nor `document.fonts` -- without this
// stub, useEventFontFaces' own status never leaves "idle" (see that hook's
// module comment), which would permanently block Reprint's confirm button
// (gated on fontsStatus reaching a terminal "ready"/"error" state). Same
// MockFontFace/stub/unstub helpers as AttendeeDrawer.test.tsx's own Task 8
// reprint block.
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
  // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts`
  // stub; real jsdom has no `fonts` property to restore.
  delete document.fonts;
}

const TEMPLATE_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
};

// Deliberately NOT chronological-alphabetical (Ada / Grace / Alan) and NOT
// re-sortable by name either -- proves the rail trusts the server's
// newest-first order verbatim rather than re-deriving it client-side (same
// "API order trusted" convention as AttendeeDrawer.tsx's recent-activity
// list).
const ROW_CHECKIN: CheckinActionRow = {
  id: "row-1",
  action: "checkin",
  station_id: "st-1",
  created_at: "2026-07-17T12:34:00Z",
  attendee: { id: "att-1", first_name: "Ada", last_name: "Lovelace", code: "CODE1" },
};
const ROW_REPRINT: CheckinActionRow = {
  id: "row-2",
  action: "reprint",
  station_id: "st-1",
  created_at: "2026-07-17T12:30:00Z",
  attendee: { id: "att-2", first_name: "Grace", last_name: "Hopper", code: "CODE2" },
};
const ROW_UNDO: CheckinActionRow = {
  id: "row-3",
  action: "undo",
  station_id: null,
  created_at: "2026-07-17T12:00:00Z",
  attendee: { id: "att-3", first_name: "Alan", last_name: "Turing", code: "CODE3" },
};

const ADA_FULL: Attendee = {
  id: "att-1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "CODE1",
  checkin_status: true,
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

let actionsRows: CheckinActionRow[] = [ROW_CHECKIN, ROW_REPRINT, ROW_UNDO];
let actionsHitCount = 0;
let actionsStatus = 200;

// Disconnected by default (mirrors AttendeeDrawer.test.tsx's own baseline) --
// individual reprint tests flip this to true.
let agentHealthOk = false;
let printersResponse: Array<{ name: string; type: string }> = [];
let defaultPrinterResponse: { default: string | null } = { default: null };
let printCapture: { printer_name: string; zpl: string } | null = null;
let printStatus = 200;
let printDelayMs = 0;
let markPrintedHitCount = 0;
let lastMarkPrintedBody: unknown;

let undoHitCount = 0;
let lastUndoBody: unknown;
let undoDelayMs = 0;
let undoStatus = 200;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/checkin-actions", () => {
    actionsHitCount += 1;
    if (actionsStatus !== 200) return new HttpResponse(null, { status: actionsStatus });
    return HttpResponse.json({ actions: actionsRows });
  }),
  http.post("http://api.test/api/events/:eventId/checkin/undo", async ({ request }) => {
    undoHitCount += 1;
    lastUndoBody = await request.json();
    if (undoDelayMs) await delay(undoDelayMs);
    if (undoStatus !== 200) return new HttpResponse(null, { status: undoStatus });
    return HttpResponse.json({ attendee: { ...ADA_FULL, checkin_status: false } });
  }),
  http.get("http://api.test/api/events/:eventId/attendees", () => HttpResponse.json([])),
  http.get("http://api.test/api/attendees/:id", ({ params }) => {
    if (params.id === "att-1") return HttpResponse.json(ADA_FULL);
    return new HttpResponse(null, { status: 404 });
  }),
  http.get("http://api.test/api/events/:id/badge-template", () =>
    HttpResponse.json({ template: TEMPLATE_DOC, version: 1 }),
  ),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.post("http://api.test/api/attendees/:attendeeId/printed", async ({ request }) => {
    markPrintedHitCount += 1;
    lastMarkPrintedBody = await request.json().catch(() => undefined);
    return HttpResponse.json({ printed_count: 1 });
  }),
  http.get("http://agent.test/health", () =>
    agentHealthOk ? new HttpResponse(null, { status: 200 }) : new HttpResponse(null, { status: 503 }),
  ),
  http.get("http://agent.test/printers", () => HttpResponse.json(printersResponse)),
  http.get("http://agent.test/printers/default", () => HttpResponse.json(defaultPrinterResponse)),
  http.post("http://agent.test/print", async ({ request }) => {
    const body = (await request.json()) as { printer_name: string; zpl: string };
    printCapture = body;
    if (printDelayMs) await delay(printDelayMs);
    if (printStatus !== 200) return HttpResponse.text("printer offline", { status: printStatus });
    return HttpResponse.json({ status: "printed" });
  }),
);
void server;

// Mounted alongside RecentScansRail in the undo tests, exactly like
// AttendeeDrawer.test.tsx's AttendeesListObserver -- proves invalidation
// actually refetches a REAL subscribed observer elsewhere, not just an
// isolated invalidateQueries call.
function AttendeesListObserver() {
  useAttendeesPage("evt-1", { page: 1 });
  return null;
}

// The no-template/missing-font reprint errors link to the badge editor
// route, which needs a router context to resolve `Link` -- same minimal
// single-route harness as AttendeeDrawer.test.tsx's own testRouter (this
// suite exercises the rail's own rendering, not routing).
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderRail(stationId: string | null = "st-1", extra?: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={testRouter}>
        {extra}
        <RecentScansRail eventId="evt-1" stationId={stationId} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("RecentScansRail", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    actionsRows = [ROW_CHECKIN, ROW_REPRINT, ROW_UNDO];
    actionsHitCount = 0;
    actionsStatus = 200;
    agentHealthOk = false;
    printersResponse = [];
    defaultPrinterResponse = { default: null };
    printCapture = null;
    printStatus = 200;
    printDelayMs = 0;
    markPrintedHitCount = 0;
    lastMarkPrintedBody = undefined;
    undoHitCount = 0;
    lastUndoBody = undefined;
    undoDelayMs = 0;
    undoStatus = 200;
  });

  it("renders the last-50 feed newest-first (attendee name, code, action label, time), trusting the server's own order", async () => {
    renderRail();

    const rows = await screen.findAllByTestId("checkin-rail-row");
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(rows[0]).getByText("CODE1")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Checked in")).toBeInTheDocument();
    expect(within(rows[0]).getByText("12:34")).toBeInTheDocument();

    expect(within(rows[1]).getByText("Grace Hopper")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Reprinted")).toBeInTheDocument();

    expect(within(rows[2]).getByText("Alan Turing")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Undone")).toBeInTheDocument();
  });

  it("shows an empty state when there are no scans yet", async () => {
    actionsRows = [];
    renderRail();

    expect(await screen.findByText("No scans yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("checkin-rail-row")).not.toBeInTheDocument();
  });

  it("shows an honest error state when the feed fails to load", async () => {
    actionsStatus = 500;
    renderRail();

    expect(await screen.findByText("Couldn't load recent scans.")).toBeInTheDocument();
  });

  describe("Details popover", () => {
    it("shows the attendee's name, code, and (for a checkin row) the first-scan time", async () => {
      const user = userEvent.setup();
      renderRail();
      const rows = await screen.findAllByTestId("checkin-rail-row");

      await user.click(within(rows[0]).getByRole("button", { name: "Details" }));

      const popover = await screen.findByRole("menu");
      expect(within(popover).getByText("Ada Lovelace")).toBeInTheDocument();
      expect(within(popover).getByText("CODE1")).toBeInTheDocument();
      expect(within(popover).getByText("First checked in at 12:34")).toBeInTheDocument();
    });

    it("shows an undone/reprinted-specific time line for undo/reprint rows instead of the first-scan copy", async () => {
      const user = userEvent.setup();
      renderRail();
      const rows = await screen.findAllByTestId("checkin-rail-row");

      await user.click(within(rows[2]).getByRole("button", { name: "Details" }));
      const popover = await screen.findByRole("menu");
      expect(within(popover).getByText("Check-in undone at 12:00")).toBeInTheDocument();
    });
  });

  describe("Reprint", () => {
    beforeEach(() => stubFontFaceApi());
    afterEach(() => unstubFontFaceApi());

    it("disables Reprint (with a discoverable reason) when the print agent is unreachable", async () => {
      renderRail();
      const rows = await screen.findAllByTestId("checkin-rail-row");

      const reprintButton = within(rows[0]).getByRole("button", { name: "Reprint" });
      await waitFor(() => expect(reprintButton).toBeDisabled());
      expect(reprintButton).toHaveAttribute("title", "Can't reach the local print agent.");
    });

    it("names the agent's default printer, sends on confirm with the printContext body, and refetches the feed", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");
      await waitFor(() => expect(actionsHitCount).toBe(1));

      const reprintButton = within(rows[0]).getByRole("button", { name: "Reprint" });
      await waitFor(() => expect(reprintButton).toBeEnabled());
      await user.click(reprintButton);

      const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
      expect(within(dialog).getByText("Print Ada Lovelace's badge on Zebra_ZD421?")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      await waitFor(() => expect(printCapture).not.toBeNull());
      expect(printCapture?.printer_name).toBe("Zebra_ZD421");
      expect(printCapture?.zpl).toContain("^FDAda^FS");
      await waitFor(() => expect(markPrintedHitCount).toBe(1));
      expect(lastMarkPrintedBody).toEqual({ event_id: "evt-1", station_id: "st-1" });

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument());
      // The station's own reprint refetches the feed (P4.2 upgrades this to
      // SSE) -- the newly-logged 'reprint' row must not wait for some
      // unrelated invalidation.
      await waitFor(() => expect(actionsHitCount).toBeGreaterThan(1));
    });

    it("blocks every dismissal path (Escape, outside click, Cancel) while a print is in flight", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      printDelayMs = 40;
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");

      const reprintButton = within(rows[0]).getByRole("button", { name: "Reprint" });
      await waitFor(() => expect(reprintButton).toBeEnabled());
      await user.click(reprintButton);
      const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
      const confirmButton = within(dialog).getByRole("button", { name: "Print" });
      await user.click(confirmButton);

      await waitFor(() => expect(confirmButton).toBeDisabled());
      // Cancel is inert while sending -- the dialog stays open throughout.
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("dialog", { name: "Reprint badge" })).toBe(dialog);
      expect(within(dialog).getByText(/can't be cancelled/)).toBeInTheDocument();

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reprint badge" })).not.toBeInTheDocument());
    });

    it("shows the honest may-still-print timeout copy (not the raw client message) when the send times out", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      const printSpy = vi.spyOn(agentClient, "print").mockRejectedValue(new AgentPrintTimeoutError(30_000));
      try {
        const user = userEvent.setup();
        renderRail("st-1");
        const rows = await screen.findAllByTestId("checkin-rail-row");
        const reprintButton = within(rows[0]).getByRole("button", { name: "Reprint" });
        await waitFor(() => expect(reprintButton).toBeEnabled());
        await user.click(reprintButton);
        const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
        await user.click(within(dialog).getByRole("button", { name: "Print" }));

        expect(
          await within(dialog).findByText(
            "The print agent didn't respond. The badge may still print — check the printer before retrying.",
          ),
        ).toBeInTheDocument();
        expect(markPrintedHitCount).toBe(0);
      } finally {
        printSpy.mockRestore();
      }
    });

    it("shows an honest no-template message linking the badge editor, and never calls the agent, when the event has no saved template", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      server.use(
        http.get("http://api.test/api/events/:id/badge-template", () =>
          HttpResponse.json({ template: null, version: 0 }),
        ),
      );
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");
      const reprintButton = within(rows[0]).getByRole("button", { name: "Reprint" });
      await waitFor(() => expect(reprintButton).toBeEnabled());
      await user.click(reprintButton);
      const dialog = await screen.findByRole("dialog", { name: "Reprint badge" });
      await user.click(within(dialog).getByRole("button", { name: "Print" }));

      expect(await within(dialog).findByText(/doesn.t have a badge template yet/)).toBeInTheDocument();
      expect(within(dialog).getByRole("link", { name: "Open the badge editor" })).toHaveAttribute(
        "href",
        "/events/evt-1/badge",
      );
      expect(printCapture).toBeNull();
      expect(screen.getByRole("dialog", { name: "Reprint badge" })).toBe(dialog);
    });
  });

  describe("Undo", () => {
    it("confirms, POSTs the undo with {attendee_id, station_id}, and both the feed and the attendees list refetch (subscribed observers)", async () => {
      const user = userEvent.setup();
      renderRail("st-1", <AttendeesListObserver />);
      const rows = await screen.findAllByTestId("checkin-rail-row");
      await waitFor(() => expect(actionsHitCount).toBe(1));

      await user.click(within(rows[0]).getByRole("button", { name: "Undo" }));
      const dialog = await screen.findByRole("dialog", { name: "Undo check-in" });
      expect(within(dialog).getByText(/Ada Lovelace/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Undo check-in" }));

      await waitFor(() => expect(undoHitCount).toBe(1));
      expect(lastUndoBody).toEqual({ attendee_id: "att-1", station_id: "st-1" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Undo check-in" })).not.toBeInTheDocument());

      await waitFor(() => expect(actionsHitCount).toBeGreaterThan(1));
    });

    it("blocks dismissal while the undo is in flight, same convention as reprint", async () => {
      undoDelayMs = 40;
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");

      await user.click(within(rows[0]).getByRole("button", { name: "Undo" }));
      const dialog = await screen.findByRole("dialog", { name: "Undo check-in" });
      const confirmButton = within(dialog).getByRole("button", { name: "Undo check-in" });
      await user.click(confirmButton);

      await waitFor(() => expect(confirmButton).toBeDisabled());
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("dialog", { name: "Undo check-in" })).toBe(dialog);

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Undo check-in" })).not.toBeInTheDocument());
    });

    it("keeps the confirm dialog open with an inline error when the undo fails", async () => {
      undoStatus = 500;
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");

      await user.click(within(rows[0]).getByRole("button", { name: "Undo" }));
      const dialog = await screen.findByRole("dialog", { name: "Undo check-in" });
      await user.click(within(dialog).getByRole("button", { name: "Undo check-in" }));

      expect(await within(dialog).findByText("Couldn't undo the check-in. Try again.")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Undo check-in" })).toBe(dialog);
    });
  });

  // Regression test for a task-9 review finding: `anyMutationPending`
  // (reprintPrinting || undoCheckin.isPending) is still false while a
  // dialog is merely OPEN but not yet confirmed, so the per-row trigger
  // buttons -- gated only on that flag -- previously let a user open BOTH
  // dialog types at once (e.g. open row A's Reprint dialog, then click row
  // B's still-enabled Undo trigger), each confirmable independently against
  // its own pending flag. That could fire a reprint and an undo
  // concurrently, potentially against the SAME attendee. The fix gates the
  // trigger buttons on `reprintTarget !== null || undoTarget !== null` too,
  // so once either dialog is open (confirmed or not), no other row's
  // trigger can open a second, competing dialog.
  describe("Dialog mutual exclusion", () => {
    beforeEach(() => stubFontFaceApi());
    afterEach(() => unstubFontFaceApi());

    it("disables every other row's Undo trigger while a Reprint dialog is open but not yet confirmed", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");

      const reprintButtonRow0 = within(rows[0]).getByRole("button", { name: "Reprint" });
      await waitFor(() => expect(reprintButtonRow0).toBeEnabled());
      await user.click(reprintButtonRow0);
      await screen.findByRole("dialog", { name: "Reprint badge" });

      // Neither mutation has actually started (reprintPrinting is still
      // false -- the dialog is idle, unconfirmed) -- yet row 1's Undo
      // trigger must already be disabled, since confirming it would open a
      // second, independent dialog concurrently with the open Reprint one.
      // Radix marks the rest of the page `aria-hidden` while its Dialog is
      // open, so `{ hidden: true }` is needed here to still query the
      // (inert-to-screen-readers, but still DOM-present) row underneath.
      const undoButtonRow1 = within(rows[1]).getByRole("button", { name: "Undo", hidden: true });
      expect(undoButtonRow1).toBeDisabled();
    });

    it("disables every other row's Reprint trigger while an Undo dialog is open but not yet confirmed", async () => {
      agentHealthOk = true;
      printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
      defaultPrinterResponse = { default: "Zebra_ZD421" };
      const user = userEvent.setup();
      renderRail("st-1");
      const rows = await screen.findAllByTestId("checkin-rail-row");

      // Confirm the agent has already finished its own reachability check
      // (Reprint enabled) BEFORE opening the Undo dialog, so the later
      // "disabled" assertion is caused by the Undo dialog being open, not
      // by Reprint's reachability check simply not having resolved yet.
      const reprintButtonRow1 = within(rows[1]).getByRole("button", { name: "Reprint" });
      await waitFor(() => expect(reprintButtonRow1).toBeEnabled());

      const undoButtonRow0 = within(rows[0]).getByRole("button", { name: "Undo" });
      await user.click(undoButtonRow0);
      await screen.findByRole("dialog", { name: "Undo check-in" });

      // undoCheckin.isPending is still false here (unconfirmed) -- row 1's
      // Reprint trigger must already be disabled for the same reason as
      // above, in the opposite direction. Radix marks the rest of the page
      // `aria-hidden` while its Dialog is open, so `{ hidden: true }` is
      // needed here to still query the row underneath.
      expect(within(rows[1]).getByRole("button", { name: "Reprint", hidden: true })).toBeDisabled();
    });
  });
});
