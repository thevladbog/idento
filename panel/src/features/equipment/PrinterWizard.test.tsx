// P4.3 Task 8 -- PrinterWizard (board 5b): Find -> Test -> Save with
// physical verification, plus the RETEST entry point (controller-resolved
// plan addition, task-8-brief.md) for a saved row's "Test print" button.
//
// Harness mirrors TestPrintDialog.test.tsx's MSW shape: a backend origin
// (http://api.test, for the registry POST /devices) and the agent origin
// (http://agent.test, for /printers, /print, /printers/add,
// /printers/default).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { PrinterWizard, type PrinterWizardProps } from "./PrinterWizard";
import { agentClient, AgentPrintTimeoutError } from "../../shared/agent/agentClient";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let agentPrinters: Array<{ name: string; type: string }> = [];
let printCalls: Array<{ printer_name: string; zpl: string }> = [];
let printStatus = 200;
let printDelayMs = 0;
let addPrinterCalls: Array<{ name: string; ip: string; port: number }> = [];
let addPrinterStatus = 201;
let setDefaultCalls: Array<{ default: string }> = [];
let setDefaultStatus = 200;
let createDeviceCalls: Array<{ machineId: string; body: unknown }> = [];
let createDeviceStatus = 201;
let testPassedCalls: string[] = [];

const server = startMswServer(
  http.get("http://agent.test/health", () => new HttpResponse(null, { status: 200 })),
  http.get("http://agent.test/printers", () => HttpResponse.json(agentPrinters)),
  http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: null })),
  http.post("http://agent.test/print", async ({ request }) => {
    printCalls.push((await request.json()) as { printer_name: string; zpl: string });
    if (printDelayMs) await delay(printDelayMs);
    if (printStatus !== 200) return new HttpResponse("printer not found", { status: printStatus });
    return HttpResponse.json({ status: "printed" });
  }),
  http.post("http://agent.test/printers/add", async ({ request }) => {
    const body = (await request.json()) as { name: string; ip: string; port: number };
    addPrinterCalls.push(body);
    if (addPrinterStatus !== 201) return new HttpResponse("name and ip are required", { status: addPrinterStatus });
    return HttpResponse.json({ status: "added", name: body.name, address: `${body.ip}:${body.port}` }, { status: 201 });
  }),
  http.post("http://agent.test/printers/default", async ({ request }) => {
    const body = (await request.json()) as { default: string };
    setDefaultCalls.push(body);
    if (setDefaultStatus !== 200) return new HttpResponse(null, { status: setDefaultStatus });
    return HttpResponse.json(body);
  }),
  http.post("http://api.test/api/equipment/machines/:machineId/devices", async ({ params, request }) => {
    const body = await request.json();
    createDeviceCalls.push({ machineId: params.machineId as string, body });
    if (createDeviceStatus !== 201) return new HttpResponse(JSON.stringify({ error: "boom" }), { status: createDeviceStatus });
    return HttpResponse.json(
      {
        id: "dev-new",
        class: "printer",
        kind: "system",
        display_name: "New Printer",
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

function renderWizard(overrides: Partial<PrinterWizardProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const props: PrinterWizardProps = {
    open: true,
    onClose,
    machineId: "mach-1",
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={qc}>
      <PrinterWizard {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onClose, qc, props };
}

describe("PrinterWizard", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    agentPrinters = [];
    printCalls = [];
    printStatus = 200;
    printDelayMs = 0;
    addPrinterCalls = [];
    addPrinterStatus = 201;
    setDefaultCalls = [];
    setDefaultStatus = 200;
    createDeviceCalls = [];
    createDeviceStatus = 201;
    testPassedCalls = [];
  });

  describe("Find step", () => {
    it("lists live printers and picking one advances to Test, firing exactly one print", async () => {
      const user = userEvent.setup();
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      renderWizard();

      const row = await screen.findByRole("button", { name: /HP_Smart_Tank_790/ });
      await user.click(row);

      expect(await screen.findByText("Did the test label print correctly?")).toBeInTheDocument();
      await waitFor(() => expect(printCalls).toHaveLength(1));
      expect(printCalls[0].printer_name).toBe("HP_Smart_Tank_790");
      expect(printCalls[0].zpl).toContain("^CI28");
      expect(printCalls[0].zpl).toContain("Кириллица 123");

      // Stays at exactly one fired print (mount-fires-once), no extra fire
      // from re-render.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(printCalls).toHaveLength(1);
    });

    it("manual IP path: reveals a name/ip/port form, submits POST /printers/add, then advances with the new printer selected", async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(await screen.findByText("Enter IP manually"));
      await user.type(screen.getByLabelText("Printer name"), "Network_Office");
      await user.type(screen.getByLabelText("IP address"), "192.168.0.245");
      const portInput = screen.getByLabelText("Port");
      await user.clear(portInput);
      await user.type(portInput, "9100");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(addPrinterCalls).toHaveLength(1));
      expect(addPrinterCalls[0]).toEqual({ name: "Network_Office", ip: "192.168.0.245", port: 9100 });

      expect(await screen.findByText("Did the test label print correctly?")).toBeInTheDocument();
      await waitFor(() => expect(printCalls).toHaveLength(1));
      expect(printCalls[0].printer_name).toBe("Network_Office");
    });
  });

  describe("Test step", () => {
    async function reachTestStep(user: ReturnType<typeof userEvent.setup>) {
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      renderWizard();
      await user.click(await screen.findByRole("button", { name: /HP_Smart_Tank_790/ }));
      await screen.findByText("Did the test label print correctly?");
    }

    it("'Print again' refires the print", async () => {
      const user = userEvent.setup();
      await reachTestStep(user);
      await waitFor(() => expect(printCalls).toHaveLength(1));

      await user.click(screen.getByRole("button", { name: "Print again" }));
      await waitFor(() => expect(printCalls).toHaveLength(2));
    });

    it("'Something's off…' reveals troubleshooting hints without blocking advancing to Save", async () => {
      const user = userEvent.setup();
      await reachTestStep(user);

      await user.click(screen.getByRole("button", { name: "Something's off…" }));
      expect(
        await screen.findByText(
          "Check the printer's darkness setting, that labels are loaded correctly, and that the right driver or port is selected.",
        ),
      ).toBeInTheDocument();

      // Still able to confirm afterwards -- not a dead end.
      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));
      expect(await screen.findByText("Printer name")).toBeInTheDocument(); // Save step's display-name label
    });

    it("'Yes, looks right' sets the passed flag and advances to Save", async () => {
      const user = userEvent.setup();
      await reachTestStep(user);

      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));
      expect(await screen.findByLabelText("Printer name")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Make this the default printer for check-in stations on this computer"),
      ).toBeChecked();
    });

    // Review fix round Minor 7: the wizard's Test step prints a physical
    // test LABEL, not an attendee badge -- the shared badge-worded
    // `printAgentTimeout` copy would sit visibly next to this wizard's own
    // "check the label" success line and contradict it. Same transport-ack
    // honesty rule (never claim "printed", never present as a plain
    // failure), label-appropriate wording.
    it("shows honest label-worded may-still-print timeout copy (not a failure) when the send times out", async () => {
      const user = userEvent.setup();
      const printSpy = vi.spyOn(agentClient, "print").mockRejectedValue(new AgentPrintTimeoutError(30_000));
      try {
        await reachTestStep(user);
        expect(
          await screen.findByText(
            "The print agent didn't respond. The label may still print — check the printer before retrying.",
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/badge/i)).not.toBeInTheDocument();
      } finally {
        printSpy.mockRestore();
      }
    });
  });

  describe("dismissal locking", () => {
    // Review fix round Minor 4: same P3.2 physical-output convention as
    // TestPrintDialog.test.tsx's own dismissal-lock test -- every dismiss
    // path (Escape, ✕) is inert while a send is in flight, and the ✕ is
    // hidden entirely (not just inert) so it never LOOKS like a live
    // control that silently does nothing.
    it("hides the ✕ and ignores Escape while a test print is in flight", async () => {
      const user = userEvent.setup();
      printDelayMs = 120;
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      const rendered = renderWizard();

      await user.click(await screen.findByRole("button", { name: /HP_Smart_Tank_790/ }));
      await screen.findByText("Did the test label print correctly?");
      // The auto-fired print is still in flight (printDelayMs).
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(rendered.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Once the send settles, dismissal unlocks again.
      await screen.findByText("Sent to HP_Smart_Tank_790 — check the label");
      await user.keyboard("{Escape}");
      expect(rendered.onClose).toHaveBeenCalled();
    });

    it("hides the ✕ and ignores Escape while the manual printer add is in flight", async () => {
      const user = userEvent.setup();
      server.use(
        http.post("http://agent.test/printers/add", async () => {
          await delay(120);
          return HttpResponse.json({ status: "added", name: "n", address: "a" }, { status: 201 });
        }),
      );
      const rendered = renderWizard();

      await user.click(await screen.findByText("Enter IP manually"));
      await user.type(screen.getByLabelText("Printer name"), "Network_Office");
      await user.type(screen.getByLabelText("IP address"), "192.168.0.245");
      await user.click(screen.getByRole("button", { name: "Save" }));

      // The add POST is still in flight.
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(rendered.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Settles into the Test step -- the wizard moved on, not closed.
      expect(await screen.findByText("Did the test label print correctly?")).toBeInTheDocument();
    });
  });

  describe("Save step", () => {
    async function reachSaveStep(user: ReturnType<typeof userEvent.setup>) {
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      const rendered = renderWizard();
      await user.click(await screen.findByRole("button", { name: /HP_Smart_Tank_790/ }));
      await screen.findByText("Did the test label print correctly?");
      await waitFor(() => expect(printCalls).toHaveLength(1));
      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));
      await screen.findByLabelText("Printer name");
      return rendered;
    }

    it("prefills display_name from the selected printer and defaults the default checkbox to checked, then submits {class, kind, config, make_default, test_passed}, mirrors the default onto the agent, and closes", async () => {
      const user = userEvent.setup();
      const rendered = await reachSaveStep(user);

      const nameInput = screen.getByLabelText<HTMLInputElement>("Printer name");
      expect(nameInput.value).toBe("HP_Smart_Tank_790");
      const checkbox = screen.getByLabelText<HTMLInputElement>(
        "Make this the default printer for check-in stations on this computer",
      );
      expect(checkbox.checked).toBe(true);

      await user.click(screen.getByRole("button", { name: "Save printer" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0]).toEqual({
        machineId: "mach-1",
        body: {
          class: "printer",
          kind: "system",
          display_name: "HP_Smart_Tank_790",
          config: { agent_name: "HP_Smart_Tank_790" },
          make_default: true,
          test_passed: true,
        },
      });

      await waitFor(() => expect(setDefaultCalls).toHaveLength(1));
      expect(setDefaultCalls[0]).toEqual({ default: "HP_Smart_Tank_790" });

      await waitFor(() => expect(rendered.onClose).toHaveBeenCalled());
    });

    it("saving without a confirmed test sends test_passed: false", async () => {
      const user = userEvent.setup();
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      renderWizard();
      await user.click(await screen.findByRole("button", { name: /HP_Smart_Tank_790/ }));
      await screen.findByText("Did the test label print correctly?");
      await waitFor(() => expect(printCalls).toHaveLength(1));

      // Straight to Save WITHOUT clicking "Yes, looks right".
      await user.click(screen.getByRole("button", { name: "Save printer" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0].body).toMatchObject({ test_passed: false });
    });

    it("manual IP path saves kind=network with ip/port in config", async () => {
      const user = userEvent.setup();
      renderWizard();
      await user.click(await screen.findByText("Enter IP manually"));
      await user.type(screen.getByLabelText("Printer name"), "Network_Office");
      await user.type(screen.getByLabelText("IP address"), "192.168.0.245");
      const portInput = screen.getByLabelText("Port");
      await user.clear(portInput);
      await user.type(portInput, "9100");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await screen.findByText("Did the test label print correctly?");
      await user.click(screen.getByRole("button", { name: "Save printer" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0].body).toMatchObject({
        class: "printer",
        kind: "network",
        config: { agent_name: "Network_Office", ip: "192.168.0.245", port: 9100 },
      });
    });

    // Review fix round Important 1: setMirrorWarning(true) + onClose() in
    // the same synchronous tick meant the warning NEVER painted (React 18
    // batches both setState calls into one commit, and the unanimated
    // Radix DialogContent unmounts pre-paint). House convention is
    // BulkBar.tsx's "don't auto-close; the warning is the confirmation the
    // operator reads before closing it themselves" -- the dialog must stay
    // open with the warning visible and close only on an explicit dismiss.
    it("mirror failure (agent 500): the save resolves, the dialog STAYS OPEN with the warning visible, and closes only on the explicit dismiss", async () => {
      const user = userEvent.setup();
      setDefaultStatus = 500;
      const rendered = renderWizard();
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      await user.click(await screen.findByRole("button", { name: /HP_Smart_Tank_790/ }));
      await screen.findByText("Did the test label print correctly?");
      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));
      await screen.findByLabelText("Printer name");

      await user.click(screen.getByRole("button", { name: "Save printer" }));

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      await waitFor(() =>
        expect(
          screen.getByText("Saved — but the agent didn't accept the default. It will sync on the next visit."),
        ).toBeInTheDocument(),
      );

      // NOT auto-closed: the operator gets to actually read the warning.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(rendered.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // The save already committed -- re-submitting must be impossible
      // (the footer's Save/Back pair is replaced by an explicit Close).
      expect(screen.queryByRole("button", { name: "Save printer" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(rendered.onClose).toHaveBeenCalledTimes(1);
      expect(createDeviceCalls).toHaveLength(1);
    });

    // Review fix round Important 2: a network-typed printer picked off the
    // Find list (or handed in via the unsaved-row prefill) has NO ip/port
    // -- GET /printers reports {name, type} only -- and the registry
    // hard-requires config.ip/config.port for kind=network, so saving
    // as-is was a guaranteed-400 dead end. The operator knows the address
    // (they configured the printer); the Save step must collect it.
    it("network printer picked from Find: the Save step requires an ip/port form, and the save body carries config.ip/port", async () => {
      const user = userEvent.setup();
      agentPrinters = [{ name: "Warehouse_Net", type: "network" }];
      renderWizard();

      await user.click(await screen.findByRole("button", { name: /Warehouse_Net/ }));
      await screen.findByText("Did the test label print correctly?");
      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));

      // Address form is present and required: Save stays disabled until a
      // valid ip is entered (port defaults to 9100, same as the manual
      // form).
      const ipInput = await screen.findByLabelText<HTMLInputElement>("IP address");
      expect(screen.getByLabelText<HTMLInputElement>("Port").value).toBe("9100");
      expect(screen.getByRole("button", { name: "Save printer" })).toBeDisabled();

      await user.type(ipInput, "10.0.0.9");
      const saveButton = screen.getByRole("button", { name: "Save printer" });
      await waitFor(() => expect(saveButton).not.toBeDisabled());
      await user.click(saveButton);

      await waitFor(() => expect(createDeviceCalls).toHaveLength(1));
      expect(createDeviceCalls[0].body).toMatchObject({
        class: "printer",
        kind: "network",
        config: { agent_name: "Warehouse_Net", ip: "10.0.0.9", port: 9100 },
      });
    });

    it("network printer without an address: 'Save printer' clicked straight from the Test step advances to the address form instead of firing a doomed create", async () => {
      const user = userEvent.setup();
      agentPrinters = [{ name: "Warehouse_Net", type: "network" }];
      renderWizard();

      await user.click(await screen.findByRole("button", { name: /Warehouse_Net/ }));
      await screen.findByText("Did the test label print correctly?");

      // Straight to Save WITHOUT confirming the test -- the shared footer
      // makes this reachable, and it must land on the address form, never
      // POST a create the backend is guaranteed to 400.
      await user.click(screen.getByRole("button", { name: "Save printer" }));

      expect(await screen.findByLabelText("IP address")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(createDeviceCalls).toHaveLength(0);
    });

    it("manual-IP printers (address already known) do NOT get the redundant Save-step address form", async () => {
      const user = userEvent.setup();
      renderWizard();
      await user.click(await screen.findByText("Enter IP manually"));
      await user.type(screen.getByLabelText("Printer name"), "Network_Office");
      await user.type(screen.getByLabelText("IP address"), "192.168.0.245");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await screen.findByText("Did the test label print correctly?");
      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));

      await screen.findByLabelText("Printer name");
      expect(screen.queryByLabelText("IP address")).not.toBeInTheDocument();
    });
  });

  describe("Find list registry exclusion", () => {
    // Review fix round Minor 5: the hub's own unsaved-rows section already
    // filters by the registry (reconcile.ts's unsavedLivePrinters), but
    // the wizard's Find list didn't -- re-picking an already-registered
    // printer would create a duplicate registry row for the same physical
    // device.
    it("excludes printers already registered on this machine (by agent name)", async () => {
      agentPrinters = [
        { name: "HP_Smart_Tank_790", type: "system" },
        { name: "Unregistered_Kitchen_Printer", type: "system" },
      ];
      renderWizard({ registeredAgentNames: ["HP_Smart_Tank_790"] });

      expect(await screen.findByRole("button", { name: /Unregistered_Kitchen_Printer/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /HP_Smart_Tank_790/ })).not.toBeInTheDocument();
    });

    it("shows the no-printers copy when every live printer is already registered", async () => {
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
      renderWizard({ registeredAgentNames: ["HP_Smart_Tank_790"] });

      expect(await screen.findByText("No printers found")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /HP_Smart_Tank_790/ })).not.toBeInTheDocument();
    });
  });

  describe("retest mode", () => {
    it("opens directly at the Test step for the given device (skips Find)", async () => {
      renderWizard({
        retest: { deviceId: "dev-1", agentName: "HP_Smart_Tank_790", displayName: "Front Desk Printer", kind: "system" },
      });

      expect(await screen.findByText("Did the test label print correctly?")).toBeInTheDocument();
      expect(screen.queryByText("Enter IP manually")).not.toBeInTheDocument();
      await waitFor(() => expect(printCalls).toHaveLength(1));
      expect(printCalls[0].printer_name).toBe("HP_Smart_Tank_790");
    });

    // Review fix round Minor 6: retest carries the saved device's real
    // kind (network here) instead of a hardcoded "system" -- unobservable
    // in retest mode today (no Save path reads it), but pinned so a future
    // retest extension never inherits a silently wrong kind. Behaviorally
    // this test proves a NETWORK device retests identically.
    it("'Yes, looks right' POSTs test-passed for the (network-kind) device and closes -- no create POST fired", async () => {
      const user = userEvent.setup();
      const rendered = renderWizard({
        retest: { deviceId: "dev-1", agentName: "Godex_G500", displayName: "Godex G500", kind: "network" },
      });

      await screen.findByText("Did the test label print correctly?");
      await user.click(screen.getByRole("button", { name: "Yes, looks right" }));

      await waitFor(() => expect(testPassedCalls).toEqual(["dev-1"]));
      expect(createDeviceCalls).toHaveLength(0);
      await waitFor(() => expect(rendered.onClose).toHaveBeenCalled());
    });

    it("'Something's off…' shows the same troubleshooting hints", async () => {
      const user = userEvent.setup();
      renderWizard({
        retest: { deviceId: "dev-1", agentName: "HP_Smart_Tank_790", displayName: "Front Desk Printer", kind: "system" },
      });

      await screen.findByText("Did the test label print correctly?");
      await user.click(screen.getByRole("button", { name: "Something's off…" }));

      expect(
        await screen.findByText(
          "Check the printer's darkness setting, that labels are loaded correctly, and that the right driver or port is selected.",
        ),
      ).toBeInTheDocument();
      expect(createDeviceCalls).toHaveLength(0);
    });
  });
});
