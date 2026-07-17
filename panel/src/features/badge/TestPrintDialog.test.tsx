// P3.2 Task 6 -- TestPrintDialog tests.
//
// Exercises BOTH MSW origins at once: the backend (`http://api.test`, for
// the event's fonts list `useEventFontFaces` needs) and the agent
// (`http://agent.test`, for `useAgentPrinters` + `agentClient.print`) --
// mirrors ZplPreviewModal.test.tsx's fonts/FontFace stub setup and
// useAgentPrinters.test.tsx/agentClient.test.ts's agent-origin handlers,
// combined for the first time in one surface.
//
// The generation pipeline itself (native vs. raster text, exact ZPL
// strings) is already pinned by generateZpl.test.ts and
// ZplPreviewModal.test.tsx -- this file only needs ONE Latin (native-path,
// jsdom-viable) fixture to prove the dialog wires generation -> agent print
// correctly; it does not re-prove the generator's own correctness.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { TestPrintDialog, type TestPrintDialogProps } from "./TestPrintDialog";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

const CONFIG = { width_mm: 90, height_mm: 55, dpi: 300 };

// Matches ZplPreviewModal.test.tsx's own SOURCE_BOUND_DOC exactly (a
// first_name-bound field, no width) so the "resolved name reaches the agent
// body" assertion below is trustworthy without re-deriving the dot math or
// escaping rules by hand here -- that golden string is generateZpl.test.ts's
// job, not this file's.
const LATIN_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
};

class MockFontFace {
  family: string;
  constructor(family: string, _source: unknown, _descriptors?: { weight?: string; style?: string }) {
    this.family = family;
  }
  load(): Promise<MockFontFace> {
    return Promise.resolve(this);
  }
}

// jsdom has neither a canvas 2D context nor the CSS Font Loading API's
// `FontFace` constructor (see useEventFontFaces.ts's own module comment) --
// every test here stubs a minimal FontFace/document.fonts so `useEventFontFaces`
// can actually reach a TERMINAL status ("ready", since the fonts list is
// always empty below), which is what unblocks generation at all.
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

let printersResponse: Array<{ name: string; type: string }> = [];
let defaultResponse: { default: string | null } = { default: null };
let healthOk = true;
let printCapture: { printer_name: string; zpl: string } | null = null;
let printStatus = 200;
let printDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.get("http://agent.test/health", () => (healthOk ? new HttpResponse(null, { status: 200 }) : HttpResponse.error())),
  http.get("http://agent.test/printers", () => HttpResponse.json(printersResponse)),
  http.get("http://agent.test/printers/default", () => HttpResponse.json(defaultResponse)),
  http.post("http://agent.test/print", async ({ request }) => {
    printCapture = (await request.json()) as { printer_name: string; zpl: string };
    if (printDelayMs) await delay(printDelayMs);
    if (printStatus !== 200) return new HttpResponse("printer not found", { status: printStatus });
    return HttpResponse.json({ status: "printed" });
  }),
);
void server;

function renderDialog(overrides: Partial<TestPrintDialogProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const props: TestPrintDialogProps = {
    open: true,
    onOpenChange,
    doc: LATIN_DOC,
    config: CONFIG,
    previewData: { first_name: "Anna" },
    previewName: "Anna Petrova",
    eventId: "evt-1",
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={qc}>
      <TestPrintDialog {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange, qc, props };
}

async function waitForSendEnabled() {
  const button = await screen.findByRole("button", { name: "Print test badge" });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

describe("TestPrintDialog", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    printersResponse = [];
    defaultResponse = { default: null };
    healthOk = true;
    printCapture = null;
    printStatus = 200;
    printDelayMs = 0;
    stubFontFaceApi();
  });

  afterEach(() => {
    unstubFontFaceApi();
  });

  it("maps the hook's checking state onto AgentStatus's stale state before the probe resolves", () => {
    renderDialog();

    const status = screen.getByText("Checking for the print agent…").closest("[data-state]");
    expect(status).toHaveAttribute("data-state", "stale");
  });

  it("shows disconnected agent status with the send CTA disabled and a reachability hint", async () => {
    healthOk = false;
    renderDialog();

    expect(await screen.findByText("Print agent unreachable")).toBeInTheDocument();
    const status = screen.getByText("Print agent unreachable").closest("[data-state]");
    expect(status).toHaveAttribute("data-state", "disconnected");
    expect(screen.getByText(/Can.t reach the local print agent/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print test badge" })).toBeDisabled();
  });

  it("connects, lists printers, and preselects the agent's default printer", async () => {
    printersResponse = [
      { name: "Zebra_ZD421", type: "system" },
      { name: "Network_Printer", type: "network" },
    ];
    defaultResponse = { default: "Zebra_ZD421" };
    renderDialog();

    expect(await screen.findByText("Print agent connected")).toBeInTheDocument();
    const select = await screen.findByLabelText<HTMLSelectElement>("Printer");
    await waitFor(() => expect(select.value).toBe("Zebra_ZD421"));
    expect(screen.getByRole("option", { name: "Network_Printer" })).toBeInTheDocument();
  });

  it("disables the send CTA when the agent is connected but reports no printers", async () => {
    printersResponse = [];
    defaultResponse = { default: null };
    renderDialog();

    expect(await screen.findByText("Print agent connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print test badge" })).toBeDisabled();
  });

  it("sends {printer_name, zpl} to the agent (zpl carries the resolved attendee name) and shows the transport-honest success line", async () => {
    const user = userEvent.setup();
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultResponse = { default: "Zebra_ZD421" };
    renderDialog();

    const sendButton = await waitForSendEnabled();
    await user.click(sendButton);

    await waitFor(() => expect(printCapture).not.toBeNull());
    expect(printCapture?.printer_name).toBe("Zebra_ZD421");
    // The resolved `first_name` binding ("Anna"), not the element's literal
    // fallback text ("Guest") -- proves generation ran against the SAME
    // previewData this dialog was handed, not some other snapshot.
    expect(printCapture?.zpl).toContain("^FDAnna^FS");
    expect(printCapture?.zpl).not.toContain("Guest");

    // Transport-honest copy (reconciliation #5): "Sent to", never "printed".
    expect(await screen.findByText("Sent to Zebra_ZD421")).toBeInTheDocument();
  });

  it("shows the fonts-not-ready warning but still lets the (native-path) send proceed when the fonts LIST fetch fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultResponse = { default: "Zebra_ZD421" };
    renderDialog();

    expect(await screen.findByText(
      "Some event fonts failed to load — this preview may use fallback glyphs.",
    )).toBeInTheDocument();

    const sendButton = await waitForSendEnabled();
    await user.click(sendButton);

    expect(await screen.findByText("Sent to Zebra_ZD421")).toBeInTheDocument();
  });

  // PR #74 review round Fix 8: a customFont family with no matching
  // uploaded font (this file's fonts endpoint always returns `[]`) must
  // block the send BEFORE the agent is ever called -- generateZpl's raster
  // branch wouldn't detect this itself (the browser silently substitutes a
  // fallback font), so this is a pre-generation check, same as
  // usePrintBadge.ts's MissingFontError for the drawer/bulk surfaces.
  it("blocks the send and shows a named-family missing-font message when the doc references a customFont with no matching uploaded font", async () => {
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultResponse = { default: "Zebra_ZD421" };
    const docWithMissingFont = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        {
          id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest",
          customFont: "Brand Sans",
        },
      ],
    };
    renderDialog({ doc: docWithMissingFont });

    expect(await screen.findByRole("alert")).toHaveTextContent(/Font Brand Sans is missing/);
    expect(screen.getByRole("button", { name: "Print test badge" })).toBeDisabled();
    // Give any (incorrect) async agent call a chance to fire before
    // asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(printCapture).toBeNull();
  });

  it("keeps the dialog open and shows the agent's own error text when the print fails", async () => {
    const user = userEvent.setup();
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultResponse = { default: "Zebra_ZD421" };
    printStatus = 404;
    renderDialog();

    const sendButton = await waitForSendEnabled();
    await user.click(sendButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(/printer not found/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(/^Sent to/)).not.toBeInTheDocument();
  });

  // PR #75 review finding: dismissal is fully locked while a print is in
  // flight (the test below), but without an explanation the disabled Cancel
  // reads as a broken button — panel/AGENTS.md's physical-output dialog
  // convention requires the visible can't-be-recalled hint on EVERY print
  // surface, and this one lacked it.
  it("explains, while the send is in flight, that it can't be cancelled and an already-sent badge will still print", async () => {
    const user = userEvent.setup();
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultResponse = { default: "Zebra_ZD421" };
    printDelayMs = 40;
    renderDialog();

    const sendButton = await waitForSendEnabled();
    // Not shown before the send starts — nothing is in flight yet.
    expect(
      screen.queryByText("Sending can't be cancelled — a badge already sent to the printer will still print."),
    ).not.toBeInTheDocument();
    await user.click(sendButton);

    expect(
      await screen.findByText("Sending can't be cancelled — a badge already sent to the printer will still print."),
    ).toBeInTheDocument();

    // Gone again once the send settles on the transport-honest result.
    expect(await screen.findByText("Sent to Zebra_ZD421")).toBeInTheDocument();
    expect(
      screen.queryByText("Sending can't be cancelled — a badge already sent to the printer will still print."),
    ).not.toBeInTheDocument();
  });

  it("blocks dismissal while a print is in flight, and never surfaces a stale result after a forced close + reopen", async () => {
    const user = userEvent.setup();
    printersResponse = [{ name: "Zebra_ZD421", type: "system" }];
    defaultResponse = { default: "Zebra_ZD421" };
    printDelayMs = 40;
    const { onOpenChange, rerender, qc, props } = renderDialog();

    const sendButton = await waitForSendEnabled();
    await user.click(sendButton);

    // Pending guard (AddAttendeeDialog pattern): Cancel is disabled and
    // Escape/overlay dismissal is inert while the print is in flight.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Defense-in-depth path (same rationale as AddAttendeeDialog's own
    // session-ref comment): a parent forcing `open` closed directly WHILE
    // the print is still in flight.
    rerender(
      <QueryClientProvider client={qc}>
        <TestPrintDialog {...props} open={false} />
      </QueryClientProvider>,
    );

    await delay(80); // let the in-flight print settle after the session was bumped

    rerender(
      <QueryClientProvider client={qc}>
        <TestPrintDialog {...props} open />
      </QueryClientProvider>,
    );

    await screen.findByText("Print agent connected");
    expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
