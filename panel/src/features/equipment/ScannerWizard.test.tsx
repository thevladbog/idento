// P4.3 Task 9 -- ScannerWizard (board 5c): USB-wedge listen-detect + COM
// port flow, plus the RETEST entry point for a saved scanner row's
// "Test scan" button. Harness mirrors PrinterWizard.test.tsx's MSW shape: a
// backend origin (http://api.test, for the registry POST /devices and
// POST /test-passed) and the agent origin (http://agent.test, for
// /scanners/ports, /scanners/add, /scan/consume).
//
// Wedge bursts are simulated with REAL timers (no vi.useFakeTimers here) --
// synchronous back-to-back fireEvent.keyDown calls land well under
// useWedgeListen's WEDGE_MAX_INTER_KEY_MS threshold on their own, so no
// explicit inter-key delay is needed to produce a fast "burst". The
// threshold/gap edge cases themselves are useWedgeListen.test.tsx's job,
// not this file's.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ScannerWizard, type ScannerWizardProps } from "./ScannerWizard";
import type { EquipmentDevice } from "./hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let scannerPorts: string[] = [];
let addComCalls: string[] = [];
let addComStatus = 200;
let consumeResponses: Array<{ code: string; time: string }> = [];
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

describe("ScannerWizard", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    scannerPorts = [];
    addComCalls = [];
    addComStatus = 200;
    consumeResponses = [];
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
    it("listen panel shows, a simulated scan reveals the Scan received row (code + terminator + ms), and fields are prefilled (name empty, terminator from detection)", async () => {
      renderWizard();

      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      expect(screen.queryByLabelText("Device name")).not.toBeInTheDocument();

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });

      expect(await screen.findByText("Scan received — TEST-4471")).toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-detection")).toHaveTextContent(/Enter/);
      expect(screen.getByTestId("scanner-wizard-detection")).toHaveTextContent(/ms/);

      const nameInput = screen.getByLabelText("Device name") as HTMLInputElement;
      expect(nameInput.value).toBe("");
      const terminatorSelect = screen.getByLabelText("Terminator") as HTMLSelectElement;
      expect(terminatorSelect.value).toBe("enter");
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

    it("Save posts {class: scanner, kind: usb_wedge, display_name, config: {terminator}, test_passed: true}", async () => {
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

    it("Save is disabled until BOTH a detection has landed and a device name is entered", async () => {
      const user = userEvent.setup();
      renderWizard();

      expect(screen.getByRole("button", { name: "Save scanner" })).toBeDisabled();

      typeWedgeBurst("TEST-4471");
      fireEvent.keyDown(window, { key: "Enter" });
      await screen.findByText("Scan received — TEST-4471");
      expect(screen.getByRole("button", { name: "Save scanner" })).toBeDisabled();

      await user.type(screen.getByLabelText("Device name"), "Desk scanner");
      expect(screen.getByRole("button", { name: "Save scanner" })).not.toBeDisabled();
    });
  });

  describe("COM path", () => {
    it("lists ports from GET /scanners/ports, picking one POSTs /scanners/add and enters the listen phase", async () => {
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
    });

    it("listen phase polls /scan/consume until a non-empty code lands, then Save posts {kind: com, config: {port_name}}", async () => {
      const user = userEvent.setup();
      scannerPorts = ["COM3"];
      consumeResponses = [
        { code: "", time: "0001-01-01T00:00:00Z" },
        { code: "PD-0107", time: "2026-07-19T00:00:00Z" },
      ];
      renderWizard();

      await user.click(screen.getByRole("button", { name: "COM port" }));
      await user.click(await screen.findByText("COM3"));
      await waitFor(() => expect(addComCalls).toEqual(["COM3"]));

      expect(await screen.findByText("Scan received — PD-0107", {}, { timeout: 3000 })).toBeInTheDocument();

      await user.type(screen.getByLabelText("Device name"), "Symbol LS2208");
      await user.click(screen.getByRole("button", { name: "Save scanner" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
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

    it("a confirmed COM detection during retest polls /scan/consume directly (no port picker) and calls test-passed", async () => {
      consumeResponses = [{ code: "COM-SCAN-1", time: "2026-07-19T00:00:00Z" }];
      renderWizard({ retest: retestDevice({ id: "dev-scanner-com", kind: "com", config: { port_name: "COM3" } }) });

      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      expect(addComCalls).toEqual([]);

      expect(await screen.findByText("Scan received — COM-SCAN-1", {}, { timeout: 3000 })).toBeInTheDocument();
      await waitFor(() => expect(testPassedCalls).toEqual(["dev-scanner-com"]));
    });
  });
});
