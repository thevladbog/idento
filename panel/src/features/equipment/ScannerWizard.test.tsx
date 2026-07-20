// P4.3 Task 9 -- ScannerWizard (board 5c): USB-wedge listen-detect + COM
// port flow, plus the RETEST entry point for a saved scanner row's
// "Test scan" button. Harness mirrors PrinterWizard.test.tsx's MSW shape: a
// backend origin (http://api.test, for the registry POST /devices and
// POST /test-passed) and the agent origin (http://agent.test, for
// /scanners/ports, /scanners/add, /scan/consume).
//
// Wedge bursts are simulated with REAL timers (no vi.useFakeTimers) --
// synchronous back-to-back fireEvent.keyDown calls land well under
// useWedgeListen's WEDGE_MAX_INTER_KEY_MS threshold on their own, so no
// explicit inter-key delay is needed to produce a fast "burst". The
// threshold/gap edge cases themselves are useWedgeListen.test.tsx's job,
// not this file's.
//
// The COM listen-phase tests use FAKE timers (task-9 review fix round,
// Minor finding): the poll runs at a real 700ms interval, and burning
// multiple real intervals per test added seconds of wall-clock to the
// suite. Same fake-timer + advanceTimersByTimeAsync discipline as
// useConnectionState.test.tsx's poll test (react-query's notifyManager
// batches on a macrotask, so a 0ms async advance flushes it); those tests
// drive clicks with fireEvent + explicit flushes instead of userEvent
// (which needs its own advanceTimers plumbing under fake timers) and
// assert with synchronous getBy/queryBy (waitFor's fake-timer detection
// doesn't fire under vitest globals).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { ScannerWizard, type ScannerWizardProps } from "./ScannerWizard";
import type { EquipmentDevice } from "./hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let scannerPorts: string[] = [];
let addComCalls: string[] = [];
let addComStatus = 200;
let consumeResponses: Array<{ code: string; time: string }> = [];
let consumeHits = 0;
let createDeviceCalls: Array<{ machineId: string; body: unknown }> = [];
let createDeviceStatus = 201;
let testPassedCalls: string[] = [];

const server = startMswServer(
  http.get("http://agent.test/scanners/ports", () => HttpResponse.json(scannerPorts.map((port_name) => ({ port_name })))),
  http.post("http://agent.test/scanners/add", async ({ request }) => {
    const body = (await request.json()) as { port_name: string };
    addComCalls.push(body.port_name);
    if (addComStatus !== 200) return new HttpResponse("could not open port", { status: addComStatus });
    return HttpResponse.json({ status: "added", name: `Scanner_${body.port_name}`, port: body.port_name });
  }),
  http.post("http://agent.test/scan/consume", () => {
    consumeHits += 1;
    const next = consumeResponses.shift();
    return HttpResponse.json(next ?? { code: "", time: "0001-01-01T00:00:00Z" });
  }),
  http.post("http://api.test/api/equipment/machines/:machineId/devices", async ({ params, request }) => {
    const body = await request.json();
    createDeviceCalls.push({ machineId: params.machineId as string, body });
    if (createDeviceStatus !== 201) return new HttpResponse(JSON.stringify({ error: "boom" }), { status: createDeviceStatus });
    return HttpResponse.json(
      {
        id: "dev-new-scanner",
        class: "scanner",
        kind: "usb_wedge",
        display_name: "New Scanner",
        config: {},
        is_default: false,
        test_passed_at: null,
        last_seen_at: null,
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
      },
      { status: 201 },
    );
  }),
  http.post("http://api.test/api/equipment/devices/:deviceId/test-passed", ({ params }) => {
    testPassedCalls.push(params.deviceId as string);
    return new HttpResponse(null, { status: 204 });
  }),
);
void server;

function retestDevice(overrides: Partial<EquipmentDevice> = {}): EquipmentDevice {
  return {
    id: "dev-scanner-1",
    class: "scanner",
    kind: "usb_wedge",
    display_name: "Honeywell Voyager 1200g",
    config: { terminator: "enter" },
    is_default: false,
    test_passed_at: null,
    last_seen_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as EquipmentDevice;
}

function renderWizard(overrides: Partial<ScannerWizardProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const props: ScannerWizardProps = {
    open: true,
    onClose,
    machineId: "mach-1",
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={qc}>
      <ScannerWizard {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onClose, qc, props };
}

function typeWedgeBurst(code: string) {
  for (const char of code) fireEvent.keyDown(window, { key: char });
}

// Fake-timer flush helper for the COM tests: advances by `ms`, letting
// pending MSW-intercepted fetches AND react-query's macrotask-batched
// notifications settle between simulated ticks (advanceTimersByTimeAsync,
// never the sync variant -- useConnectionState.test.tsx's precedent).
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// The COM poll's interval (mirrors ScannerWizard.tsx's own unexported
// COM_POLL_INTERVAL_MS -- kept as a literal here, same "no shared
// test-only export for a magic number" precedent as
// useConnectionState.test.tsx's DEBOUNCE_MS_FOR_TEST).
const COM_POLL_MS = 700;

// Drives a fake-timer COM session up to the listening phase: toggle to
// COM, let the ports query resolve, pick the (single) port, let the
// /scanners/add POST resolve + the effect's discard consume fire.
async function enterComListening() {
  fireEvent.click(screen.getByRole("button", { name: "COM port" }));
  await flush();
  await flush();
  fireEvent.click(within(screen.getByTestId("scanner-wizard-ports-list")).getByText("COM3"));
  await flush();
  await flush();
}

describe("ScannerWizard", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    scannerPorts = [];
    addComCalls = [];
    addComStatus = 200;
    consumeResponses = [];
    consumeHits = 0;
    createDeviceCalls = [];
    createDeviceStatus = 201;
    testPassedCalls = [];
  });

  it("shows a kind toggle (USB wedge | COM) with no Camera tab anywhere (board 5c regression guard)", () => {
    renderWizard();

    expect(screen.getByRole("button", { name: "USB / COM scanner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "COM port" })).toBeInTheDocument();
    expect(screen.queryByText(/Camera/)).not.toBeInTheDocument();
  });

  describe("USB wedge path", () => {
    it("shows the listen panel WITH the name/terminator fields already editable (review Important-1: printer parity), then a simulated scan reveals the Scan received row (code + terminator + ms) and syncs the terminator select", async () => {
      renderWizard();

      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      // Review fix round Important-1: the fields exist BEFORE any detection
      // (register-now-verify-later, PrinterWizard's precedent) -- name
      // empty, terminator at its default.
      const nameInput = screen.getByLabelText("Device name") as HTMLInputElement;
      expect(nameInput.value).toBe("");
      const terminatorSelect = screen.getByRole("combobox", { name: "Terminator" });
      expect(terminatorSelect).toHaveTextContent("Enter");
      expect(screen.queryByText("· detected")).not.toBeInTheDocument();

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Tab" });

      expect(await screen.findByText("Scan received — TEST-4471")).toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-detection")).toHaveTextContent(/Tab/);
      expect(screen.getByTestId("scanner-wizard-detection")).toHaveTextContent(/ms/);
      // Terminator synced to the detection, flagged as detected.
      expect(terminatorSelect).toHaveTextContent("Tab");
      expect(screen.getByText("· detected")).toBeInTheDocument();
    });

    it("'Scan again' resets so a fresh scan can be captured", async () => {
      renderWizard();

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });
      expect(await screen.findByText("Scan received — TEST-4471")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Scan again" }));

      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      expect(screen.queryByText("Scan received — TEST-4471")).not.toBeInTheDocument();

      typeWedgeBurst("NEW-0099");
      fireEvent.keyDown(window, { key: "Tab" });
      expect(await screen.findByText("Scan received — NEW-0099")).toBeInTheDocument();
    });

    it("Save after a confirmed detection posts {class: scanner, kind: usb_wedge, display_name, config: {terminator}, test_passed: true}", async () => {
      const user = userEvent.setup();
      renderWizard();

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });
      await screen.findByText("Scan received — TEST-4471");

      await user.type(screen.getByLabelText("Device name"), "Honeywell Voyager — desk 2");
      await user.click(screen.getByRole("button", { name: "Save scanner" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0]).toMatchObject({
        machineId: "mach-1",
        body: {
          class: "scanner",
          kind: "usb_wedge",
          display_name: "Honeywell Voyager — desk 2",
          config: { terminator: "enter" },
          test_passed: true,
        },
      });
    });

    // Review fix round Important-1 (reviewer's adjudication of report
    // concern 1 -- PrinterWizard's brief-mandated "save without a confirmed
    // test" precedent governs): a scanner can be registered without any
    // detection (hardware ordered ahead, flaky trigger, ...), with a
    // manually-picked terminator, and the save then honestly claims NO
    // passed test.
    it("Save without any detection posts test_passed: false with the manually-picked terminator", async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.type(screen.getByLabelText("Device name"), "Future desk scanner");
      await user.click(screen.getByRole("combobox", { name: "Terminator" }));
      await user.click(await screen.findByRole("option", { name: "Tab" }));
      await user.click(screen.getByRole("button", { name: "Save scanner" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0].body).toMatchObject({
        class: "scanner",
        kind: "usb_wedge",
        display_name: "Future desk scanner",
        config: { terminator: "tab" },
        test_passed: false,
      });
    });

    it("Save is disabled only while the device name is empty -- a detection is NOT required (Important-1)", async () => {
      const user = userEvent.setup();
      renderWizard();

      expect(screen.getByRole("button", { name: "Save scanner" })).toBeDisabled();

      await user.type(screen.getByLabelText("Device name"), "Desk scanner");
      expect(screen.getByRole("button", { name: "Save scanner" })).not.toBeDisabled();
    });

    // Task 9 review round 2, Important: with the fields now editable while
    // listening (Important-1's restructure), a fast typist bursting 3+
    // chars at wedge speed into the Device name input used to fabricate a
    // detection ("Scan received" + a later test_passed:true with zero
    // physical scan). Keydowns targeted at editable elements must never
    // feed detection.
    it("a wedge-speed burst typed into the Device name input never fabricates a detection; a following scan with non-editable focus still detects fresh", async () => {
      renderWizard();

      const nameInput = screen.getByLabelText("Device name");
      for (const char of "Honeywell") fireEvent.keyDown(nameInput, { key: char });
      fireEvent.keyDown(nameInput, { key: "Enter" });
      // Let the 300ms silence path expire too (real timers, one-off wait)
      // -- neither finalization route may produce a detection.
      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(screen.queryByTestId("scanner-wizard-detection")).not.toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();

      // The accumulator is clean: a legitimate scan with non-editable
      // focus detects exactly its own code.
      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });
      expect(await screen.findByText("Scan received — TEST-4471")).toBeInTheDocument();
    });
  });

  describe("COM path", () => {
    it("lists ports from GET /scanners/ports, picking one POSTs /scanners/add and enters the listen phase with the name field already editable", async () => {
      const user = userEvent.setup();
      scannerPorts = ["COM3", "COM4"];
      renderWizard();

      await user.click(screen.getByRole("button", { name: "COM port" }));
      const portsList = await screen.findByTestId("scanner-wizard-ports-list");
      expect(within(portsList).getByText("COM3")).toBeInTheDocument();
      expect(within(portsList).getByText("COM4")).toBeInTheDocument();

      await user.click(within(portsList).getByText("COM3"));

      await waitFor(() => expect(addComCalls).toEqual(["COM3"]));
      expect(await screen.findByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      // Review fix round Important-1: name field editable before (or
      // without) any detection.
      expect(screen.getByLabelText("Device name")).toBeInTheDocument();
    });

    // Review fix round Important-1's COM counterpart: port chosen ⇒ save
    // allowed without a detection, claiming test_passed: false.
    it("Save after picking a port but with no detection posts {kind: com, config: {port_name}, test_passed: false}", async () => {
      const user = userEvent.setup();
      scannerPorts = ["COM3"];
      renderWizard();

      await user.click(screen.getByRole("button", { name: "COM port" }));
      await user.click(await screen.findByText("COM3"));
      await waitFor(() => expect(addComCalls).toEqual(["COM3"]));

      await user.type(screen.getByLabelText("Device name"), "Symbol LS2208");
      await user.click(screen.getByRole("button", { name: "Save scanner" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0].body).toMatchObject({
        class: "scanner",
        kind: "com",
        display_name: "Symbol LS2208",
        config: { port_name: "COM3" },
        test_passed: false,
      });
    });

    it("surfaces an inline error and stays on the port list when POST /scanners/add fails", async () => {
      const user = userEvent.setup();
      scannerPorts = ["COM3"];
      addComStatus = 500;
      renderWizard();

      await user.click(screen.getByRole("button", { name: "COM port" }));
      await user.click(await screen.findByText("COM3"));

      expect(await screen.findByText(/could not open port/)).toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-ports-list")).toBeInTheDocument();
    });

    // PR #83 bot-review round 1, Finding 7: the explicit Cancel button used
    // to check only `saving`, not `comAdding` -- so clicking it while a
    // slow POST /scanners/add was still in flight closed the dialog with
    // no registry row AND no warning that the agent-side port may already
    // be open. handleOpenChange/preventDialogDismiss (the ✕/Escape/
    // outside-click paths) already gated on comAdding; only this button
    // didn't.
    it("gates the explicit Cancel button on comAdding too -- clicking it while POST /scanners/add is in flight does not close the dialog", async () => {
      const user = userEvent.setup();
      scannerPorts = ["COM3"];
      server.use(
        http.post("http://agent.test/scanners/add", async () => {
          await delay(120);
          return HttpResponse.json({ status: "added", name: "Scanner_COM3", port: "COM3" });
        }),
      );
      const rendered = renderWizard();

      await user.click(screen.getByRole("button", { name: "COM port" }));
      await user.click(await screen.findByText("COM3"));

      // The /scanners/add POST is still in flight.
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(rendered.onClose).not.toHaveBeenCalled();

      // Once it settles, the wizard moves on into listening -- never closed.
      expect(await screen.findByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
    });

    describe("listen phase (fake timers)", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      // Review fix round CRITICAL: the agent's scan buffer is process-wide
      // (shared by every /scan/consume caller, NOT scoped per port or per
      // session -- agent/scan_buffer.go), so a scan from BEFORE this
      // wizard opened could be sitting in it when listening starts. The
      // listen phase must fire one discard consume first and only trust
      // what arrives after it.
      it("discards a scan already buffered before listening began -- it is never reported as a detection; a scan arriving after the discard IS", async () => {
        scannerPorts = ["COM3"];
        // Tick 1 (the discard) eats the STALE code; tick 2 is a quiet
        // poll; tick 3 delivers the genuine in-session scan.
        consumeResponses = [
          { code: "STALE-99", time: "2026-07-16T00:00:00Z" },
          { code: "", time: "0001-01-01T00:00:00Z" },
          { code: "PD-0107", time: "2026-07-19T00:00:00Z" },
        ];
        renderWizard();
        await enterComListening();

        // The stale code must never surface, at any point.
        expect(screen.queryByText(/STALE-99/)).not.toBeInTheDocument();
        expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();

        await flush(COM_POLL_MS);
        expect(screen.queryByText(/STALE-99/)).not.toBeInTheDocument();
        expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();

        await flush(COM_POLL_MS);
        expect(screen.getByText("Scan received — PD-0107")).toBeInTheDocument();
        expect(screen.queryByText(/STALE-99/)).not.toBeInTheDocument();
      });

      it("polls /scan/consume until a non-empty post-discard code lands, then Save posts {kind: com, config: {port_name}, test_passed: true}", async () => {
        scannerPorts = ["COM3"];
        consumeResponses = [
          { code: "", time: "0001-01-01T00:00:00Z" },
          { code: "PD-0107", time: "2026-07-19T00:00:00Z" },
        ];
        renderWizard();
        await enterComListening();

        expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
        await flush(COM_POLL_MS);
        expect(screen.getByText("Scan received — PD-0107")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "Symbol LS2208" } });
        fireEvent.click(screen.getByRole("button", { name: "Save scanner" }));
        await flush();
        await flush();

        expect(createDeviceCalls).toHaveLength(1);
        expect(createDeviceCalls[0]).toMatchObject({
          machineId: "mach-1",
          body: {
            class: "scanner",
            kind: "com",
            display_name: "Symbol LS2208",
            config: { port_name: "COM3" },
            test_passed: true,
          },
        });
        // No terminator concept for a COM scanner -- config carries only
        // port_name (the backend rejects unknown config keys for kind=com).
        expect((createDeviceCalls[0].body as { config: Record<string, unknown> }).config).not.toHaveProperty("terminator");
      });

      // Review fix round Important-2: once the dialog closes mid-listen,
      // no further /scan/consume request may fire -- a post-close consume
      // would silently eat a real scan the check-in station needs.
      it("closing the dialog mid-listen stops the poll -- no further consume requests fire", async () => {
        scannerPorts = ["COM3"];
        const { rerender, qc, props } = renderWizard();
        await enterComListening();

        const hitsWhileOpen = consumeHits;
        expect(hitsWhileOpen).toBeGreaterThan(0);

        rerender(
          <QueryClientProvider client={qc}>
            <ScannerWizard {...props} open={false} />
          </QueryClientProvider>,
        );

        await flush(COM_POLL_MS * 5);
        expect(consumeHits).toBe(hitsWhileOpen);
      });
    });
  });

  describe("session reset on close (bot-review round 2, Finding 2)", () => {
    // The open-keyed reset effect used to only clear wedge.detection (via
    // wedge.reset()) and comCode when REOPENING (`if (!open) return;`
    // skipped them on close). Reopening into retest mode then reset
    // firedTestPassedRef to null in the SAME render pass that (via
    // deferred setState) also tries to clear the stale detection -- but
    // the retest auto-fire effect runs in that SAME pass, before
    // wedge.reset()'s setDetection(null) commits, and used to see the
    // STALE detection alongside a freshly-cleared firedTestPassedRef --
    // POSTing test-passed for the NEW retest device off a scan from a
    // PREVIOUS, unrelated session.
    it("closing with a live detection then reopening in retest mode fires no test-passed until a fresh scan lands", async () => {
      const rendered = renderWizard();

      typeWedgeBurst("STALE-CODE");
      fireEvent.keyDown(window, { key: "Enter" });
      await screen.findByText("Scan received — STALE-CODE");

      // Close -- same "parent flips `open` to false" transition
      // EquipmentPage.tsx's setScannerWizard(null) performs.
      rendered.rerender(
        <QueryClientProvider client={rendered.qc}>
          <ScannerWizard {...rendered.props} open={false} />
        </QueryClientProvider>,
      );

      // Reopen straight into retest mode for a saved device.
      rendered.rerender(
        <QueryClientProvider client={rendered.qc}>
          <ScannerWizard {...rendered.props} open={true} retest={retestDevice({ id: "dev-scanner-1" })} />
        </QueryClientProvider>,
      );

      // No stale-scan auto-pass: the previous session's detection must not
      // leak into this retest session.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(testPassedCalls).toEqual([]);
      expect(screen.queryByText("Scan received — STALE-CODE")).not.toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();

      // A fresh scan in the retest session still fires it correctly.
      typeWedgeBurst("FRESH-CODE");
      fireEvent.keyDown(window, { key: "Enter" });
      await screen.findByText("Scan received — FRESH-CODE");
      await waitFor(() => expect(testPassedCalls).toEqual(["dev-scanner-1"]));
    });
  });

  describe("retest mode", () => {
    it("opens directly at the listen step with no kind toggle and no Save button -- Close only", async () => {
      renderWizard({ retest: retestDevice() });

      expect(screen.queryByRole("button", { name: "USB / COM scanner" })).not.toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save scanner" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("a confirmed wedge detection during retest calls useMarkTestPassed (POST /test-passed) for the retested device", async () => {
      renderWizard({ retest: retestDevice({ id: "dev-scanner-1" }) });

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });

      await screen.findByText("Scan received — TEST-4471");
      await waitFor(() => expect(testPassedCalls).toEqual(["dev-scanner-1"]));

      // Still no Save button, and the dialog stays open for the operator
      // to read the result -- Close is the only way out.
      expect(screen.queryByRole("button", { name: "Save scanner" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    // PR #83 bot-review round 1, Finding 5: retest's auto-fired POST
    // /test-passed used to be outside every busy/dismissal gate -- Close
    // stayed clickable mid-flight. Closing bumps sessionRef (the
    // open-keyed reset effect), so a LATE failure's onError saw a stale
    // session and silently dropped the warning -- markTestPassed's own
    // pending state must gate Close the same way saving/comAdding already
    // gate the Find/Test footer's Cancel.
    it("gates the retest Close button on markTestPassed's pending state -- clicking it while the auto-fired POST /test-passed is in flight does not close the dialog", async () => {
      server.use(
        http.post("http://api.test/api/equipment/devices/:deviceId/test-passed", async ({ params }) => {
          testPassedCalls.push(params.deviceId as string);
          await delay(120);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const rendered = renderWizard({ retest: retestDevice({ id: "dev-scanner-1" }) });

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });
      await screen.findByText("Scan received — TEST-4471");

      // The POST /test-passed is still in flight.
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(rendered.onClose).not.toHaveBeenCalled();

      await waitFor(() => expect(testPassedCalls).toEqual(["dev-scanner-1"]));
      await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled());
    });

    it("surfaces a markTestPassed failure in-dialog even after the operator tried to close mid-flight (the attempt is blocked, so the session survives to see it)", async () => {
      server.use(
        http.post("http://api.test/api/equipment/devices/:deviceId/test-passed", async () => {
          await delay(80);
          return new HttpResponse(null, { status: 500 });
        }),
      );
      const rendered = renderWizard({ retest: retestDevice({ id: "dev-scanner-1" }) });

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });
      await screen.findByText("Scan received — TEST-4471");

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(rendered.onClose).not.toHaveBeenCalled();

      expect(
        await screen.findByText("Scan confirmed — but the server didn't record the test. It will sync on the next visit."),
      ).toBeInTheDocument();
      expect(rendered.onClose).not.toHaveBeenCalled();
    });

    // Task 9 review round 2, Important -- the editable-target guard applies
    // in retest mode too: a wedge-speed burst landing in ANY editable
    // element (retest's own dialog has no fields, so a body-level input
    // stands in for e.g. another surface's stray focus) must never
    // fabricate the detection that auto-fires markTestPassed.
    it("retest mode applies the same editable-target guard -- a wedge-speed burst into an editable element never fires markTestPassed", async () => {
      const stray = document.createElement("input");
      document.body.appendChild(stray);
      try {
        renderWizard({ retest: retestDevice({ id: "dev-scanner-1" }) });

        for (const char of "TEST-4471") fireEvent.keyDown(stray, { key: char });
        fireEvent.keyDown(stray, { key: "Enter" });
        await new Promise((resolve) => setTimeout(resolve, 350));

        expect(screen.queryByTestId("scanner-wizard-detection")).not.toBeInTheDocument();
        expect(testPassedCalls).toEqual([]);

        // A genuine scan with non-editable focus still detects and fires
        // the test-passed stamp.
        typeWedgeBurst("REAL-0001");
        fireEvent.keyDown(window, { key: "Enter" });
        await screen.findByText("Scan received — REAL-0001");
        await waitFor(() => expect(testPassedCalls).toEqual(["dev-scanner-1"]));
      } finally {
        document.body.removeChild(stray);
      }
    });

    // Review fix round CRITICAL, retest half: retest is the worst case for
    // a stale buffer (the port has been open continuously since the
    // device was registered, and retest fires markTestPassed with no
    // operator confirmation click), so a false detection here silently
    // stamps test_passed_at -- the discard must gate markTestPassed too.
    it("COM retest never fires markTestPassed off a pre-session buffered scan; only a post-discard scan does (fake timers)", async () => {
      vi.useFakeTimers();
      try {
        consumeResponses = [{ code: "STALE-99", time: "2026-07-16T00:00:00Z" }];
        renderWizard({ retest: retestDevice({ id: "dev-scanner-com", kind: "com", config: { port_name: "COM3" } }) });

        // Retest skips the port picker straight into listening (no
        // /scanners/add -- the port is already open agent-side).
        await flush();
        await flush();
        expect(addComCalls).toEqual([]);
        expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();

        // The stale scan was eaten by the discard: several more polls see
        // an empty buffer, and NO test-passed claim is ever made.
        await flush(COM_POLL_MS);
        await flush(COM_POLL_MS);
        expect(screen.queryByText(/STALE-99/)).not.toBeInTheDocument();
        expect(testPassedCalls).toEqual([]);

        // A genuine scan lands during the session -- the next poll
        // reports it and fires exactly one markTestPassed.
        consumeResponses.push({ code: "COM-REAL-1", time: "2026-07-19T00:00:00Z" });
        await flush(COM_POLL_MS);
        await flush();
        expect(screen.getByText("Scan received — COM-REAL-1")).toBeInTheDocument();
        expect(testPassedCalls).toEqual(["dev-scanner-com"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
