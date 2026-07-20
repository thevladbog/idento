// P4.3 Task 7 -- EquipmentPage (board 5a connected / 5d agent down): the
// hub itself, wiring AgentCard + two DeviceCard columns to
// useAgentInfo/useAgentPrinters/agentClient.getScanners + Task 6's
// equipment hooks/reconcile. Harness mirrors MonitorPage.test.tsx's MSW +
// QueryClientProvider shape MINUS routing (this page has no path params
// and renders in-shell via the normal protected route, per the brief).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { EquipmentPage } from "./EquipmentPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

const AGENT_INFO = {
  machine_id: "mach-1",
  hostname: "REG-DESK-01",
  version: "1.9.0",
  uptime_seconds: 3 * 3600 + 12 * 60,
};

function machine(overrides: Record<string, unknown> = {}) {
  return {
    machine_id: "mach-1",
    hostname: "REG-DESK-01",
    agent_version: "1.9.0",
    last_seen_at: "2026-07-19T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function printerLive(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-printer-live",
    class: "printer",
    kind: "system",
    display_name: "Zebra ZD421",
    config: { agent_name: "HP_Smart_Tank_790" },
    is_default: true,
    test_passed_at: null,
    last_seen_at: "2026-07-19T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function printerNotSeen(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-printer-notseen",
    class: "printer",
    kind: "network",
    display_name: "Godex G500",
    config: { agent_name: "Godex_G500", ip: "10.0.0.5", port: 9100 },
    is_default: false,
    test_passed_at: null,
    last_seen_at: "2026-07-08T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function scannerWedge(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-scanner-wedge",
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
  };
}

function scannerCom(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-scanner-com",
    class: "scanner",
    kind: "com",
    display_name: "Symbol LS2208",
    config: { port_name: "COM3" },
    is_default: false,
    test_passed_at: null,
    last_seen_at: "2026-07-19T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

let machineDevices: unknown[] = [];
let machineStatus = 200;
let upsertCalls: Array<{ machineId: string; body: unknown }> = [];
let patchCalls: Array<{ deviceId: string; body: unknown }> = [];
let deleteCalls: string[] = [];
let defaultPrinterCalls: Array<{ machineId: string; body: unknown }> = [];

let agentHealthOk = true;
let agentInfoStatus = 200;
let agentPrinters: Array<{ name: string; type: string }> = [];
let agentPrintersStatus = 200;
let agentScanners: Array<{ name: string; port_name: string }> = [];
let agentScannerPorts: string[] = [];
let addComCalls: string[] = [];
let removeComCalls: string[] = [];
let removeComStatus = 200;
let consumeScanResponses: Array<{ code: string; time: string }> = [];
// PR #83 bot-review round 2, Finding 8: the row-menu "Make default" mirror
// target -- agentClient.setDefaultPrinter(config.agent_name), same agent
// endpoint PrinterWizard.test.tsx's own `setDefaultCalls` already covers
// for the wizard's Save path.
let agentDefaultCalls: Array<{ default: string }> = [];
let agentDefaultStatus = 200;
// Edit-address mirror targets (the row-menu "Edit address…" action): ONE
// shared, ordered log for BOTH agent printer endpoints -- the honest mirror
// for a changed ip/port under the same name is remove-THEN-add (the agent's
// /printers/add exists-check skips the config update for an already-known
// name, so a bare re-add would silently revert to the old address on the
// next agent restart), and that ordering is exactly what these tests pin.
let agentPrinterMirrorCalls: Array<{ op: "remove" | "add"; body: Record<string, unknown> }> = [];
let removePrinterStatus = 200;
let addPrinterStatus = 200;
// Codex PR #85 review, Finding 3: proves the live printers cache gets
// refreshed after a successful address mirror (parity with PrinterWizard's
// own manual-add path, which already invalidates this same query).
let agentPrintersFetchCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/equipment/machines/:machineId", () => {
    if (machineStatus !== 200) return new HttpResponse(null, { status: machineStatus });
    return HttpResponse.json({ machine: machine(), devices: machineDevices });
  }),
  http.put("http://api.test/api/equipment/machines/:machineId", async ({ params, request }) => {
    const body = await request.json();
    upsertCalls.push({ machineId: params.machineId as string, body });
    return HttpResponse.json({ machine: machine(), devices: machineDevices });
  }),
  http.patch("http://api.test/api/equipment/devices/:deviceId", async ({ params, request }) => {
    const body = await request.json();
    patchCalls.push({ deviceId: params.deviceId as string, body });
    return HttpResponse.json(printerLive());
  }),
  http.delete("http://api.test/api/equipment/devices/:deviceId", ({ params }) => {
    deleteCalls.push(params.deviceId as string);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put("http://api.test/api/equipment/machines/:machineId/default-printer", async ({ params, request }) => {
    const body = await request.json();
    defaultPrinterCalls.push({ machineId: params.machineId as string, body });
    return HttpResponse.json(body);
  }),
  http.post("http://api.test/api/equipment/machines/:machineId/devices", () =>
    HttpResponse.json(printerLive(), { status: 201 }),
  ),
  http.post("http://api.test/api/equipment/devices/:deviceId/test-passed", () => new HttpResponse(null, { status: 204 })),
  http.get("http://agent.test/health", () => (agentHealthOk ? new HttpResponse(null, { status: 200 }) : HttpResponse.error())),
  http.get("http://agent.test/info", () => {
    if (agentInfoStatus === 404) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(AGENT_INFO);
  }),
  http.get("http://agent.test/printers", () => {
    agentPrintersFetchCount += 1;
    if (agentPrintersStatus !== 200) return new HttpResponse(null, { status: agentPrintersStatus });
    return HttpResponse.json(agentPrinters);
  }),
  http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: null })),
  http.post("http://agent.test/printers/default", async ({ request }) => {
    const body = (await request.json()) as { default: string };
    agentDefaultCalls.push(body);
    if (agentDefaultStatus !== 200) return new HttpResponse(null, { status: agentDefaultStatus });
    return HttpResponse.json(body);
  }),
  http.post("http://agent.test/printers/remove", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    agentPrinterMirrorCalls.push({ op: "remove", body });
    if (removePrinterStatus !== 200) return new HttpResponse("could not remove printer", { status: removePrinterStatus });
    return HttpResponse.json({ status: "removed", name: body.name });
  }),
  http.post("http://agent.test/printers/add", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    agentPrinterMirrorCalls.push({ op: "add", body });
    if (addPrinterStatus !== 200) return new HttpResponse("could not add printer", { status: addPrinterStatus });
    return HttpResponse.json({ status: "added", name: body.name, address: `${body.ip}:${body.port}` }, { status: 201 });
  }),
  http.get("http://agent.test/scanners", () => HttpResponse.json(agentScanners)),
  http.get("http://agent.test/scanners/ports", () =>
    HttpResponse.json(agentScannerPorts.map((port_name) => ({ port_name }))),
  ),
  http.post("http://agent.test/scanners/add", async ({ request }) => {
    const body = (await request.json()) as { port_name: string };
    addComCalls.push(body.port_name);
    return HttpResponse.json({ status: "added", name: `Scanner_${body.port_name}`, port: body.port_name });
  }),
  http.post("http://agent.test/scanners/remove", async ({ request }) => {
    const body = (await request.json()) as { port_name: string };
    removeComCalls.push(body.port_name);
    if (removeComStatus !== 200) return new HttpResponse("could not close port", { status: removeComStatus });
    return HttpResponse.json({ status: "removed", name: `Scanner_${body.port_name}`, port: body.port_name });
  }),
  http.post("http://agent.test/scan/consume", () => {
    const next = consumeScanResponses.shift();
    return HttpResponse.json(next ?? { code: "", time: "0001-01-01T00:00:00Z" });
  }),
);
void server;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EquipmentPage />
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe("EquipmentPage", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    machineDevices = [];
    machineStatus = 200;
    upsertCalls = [];
    patchCalls = [];
    deleteCalls = [];
    defaultPrinterCalls = [];
    agentHealthOk = true;
    agentInfoStatus = 200;
    agentPrinters = [];
    agentPrintersStatus = 200;
    agentScanners = [];
    agentScannerPorts = [];
    addComCalls = [];
    removeComCalls = [];
    removeComStatus = 200;
    consumeScanResponses = [];
    agentDefaultCalls = [];
    agentDefaultStatus = 200;
    agentPrinterMirrorCalls = [];
    removePrinterStatus = 200;
    addPrinterStatus = 200;
    agentPrintersFetchCount = 0;
  });

  describe("connected (board 5a)", () => {
    beforeEach(() => {
      machineDevices = [printerLive(), printerNotSeen(), scannerWedge(), scannerCom()];
      agentPrinters = [
        { name: "HP_Smart_Tank_790", type: "system" },
        { name: "Unregistered_Kitchen_Printer", type: "system" },
      ];
      agentScanners = [{ name: "Symbol LS2208 (open)", port_name: "COM3" }];
    });

    it("shows the agent meta line (version + hostname + uptime), the live printer's green row + mono meta, the amber not-seen row with a date, the wedge row's meta with no dot, an unsaved-printer Save affordance, and the DEFAULT chip only on the default row", async () => {
      renderPage();

      await screen.findByText("Zebra ZD421");
      expect(screen.getByText(/v1\.9\.0/)).toBeInTheDocument();
      expect(screen.getByText(/REG-DESK-01/)).toBeInTheDocument();
      expect(screen.getByText(/uptime 3 h 12 m/)).toBeInTheDocument();

      // Live printer row: green dot + mono meta line from deviceMeta.ts.
      const liveRow = screen.getByTestId("equipment-device-row-dev-printer-live");
      expect(within(liveRow).getByTestId("equipment-device-dot-dev-printer-live")).toBeInTheDocument();
      expect(within(liveRow).getByTestId("equipment-device-meta-dev-printer-live")).toHaveTextContent(
        "system · HP_Smart_Tank_790",
      );
      // DEFAULT chip only on the default row.
      expect(within(liveRow).getByText("DEFAULT")).toBeInTheDocument();

      // Not-seen printer row: amber dot + visible "Saved · not seen since
      // <date>" text, no DEFAULT chip.
      const notSeenRow = screen.getByTestId("equipment-device-row-dev-printer-notseen");
      expect(within(notSeenRow).getByTestId("equipment-device-dot-dev-printer-notseen")).toBeInTheDocument();
      expect(within(notSeenRow).getByTestId("equipment-device-notseen-dev-printer-notseen")).toHaveTextContent(
        /Saved · not seen since/,
      );
      expect(within(notSeenRow).queryByText("DEFAULT")).not.toBeInTheDocument();

      // Wedge scanner row: no dot at all (honesty rule), but its terminator
      // meta line still renders.
      const wedgeRow = screen.getByTestId("equipment-device-row-dev-scanner-wedge");
      expect(within(wedgeRow).queryByTestId("equipment-device-dot-dev-scanner-wedge")).not.toBeInTheDocument();
      expect(within(wedgeRow).getByTestId("equipment-device-meta-dev-scanner-wedge")).toHaveTextContent(
        "USB-HID · keyboard wedge · Enter",
      );

      // Unsaved live printer (reported by the agent, not in the registry):
      // a Save… affordance row.
      expect(screen.getByTestId("equipment-device-unsaved-Unregistered_Kitchen_Printer")).toHaveTextContent("Save…");
    });

    it("shows 'not seen yet' (no date) when a registry device has never been seen", async () => {
      machineDevices = [printerNotSeen({ id: "dev-never-seen", last_seen_at: null })];
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-never-seen");
      expect(within(row).getByTestId("equipment-device-notseen-dev-never-seen")).toHaveTextContent(
        "Saved · not seen yet",
      );
    });

    it("fires the machine upsert reconcile PUT exactly once, with seen_device_ids from computeSeenDeviceIds", async () => {
      renderPage();

      await waitFor(() => expect(upsertCalls).toHaveLength(1));
      expect(upsertCalls[0].machineId).toBe("mach-1");
      expect(upsertCalls[0].body).toMatchObject({
        hostname: "REG-DESK-01",
        agent_version: "1.9.0",
        seen_device_ids: ["dev-printer-live", "dev-scanner-com"],
      });

      // Stays at exactly one PUT even after settling further (no poll).
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(1);
    });

    // Task 7 review finding 1: an errored live-list fetch surfaces as an
    // EMPTY list -- reconciling then would under-report seen_device_ids
    // (genuinely-live devices get no last_seen_at advance and later show a
    // false "not seen since"). The upsert must be gated on both live lists
    // SUCCEEDING, and a skipped attempt must NOT consume the
    // once-per-machine_id ref budget -- a later successful refetch still
    // reconciles exactly once.
    it("does NOT fire the reconcile upsert while the live printers fetch has errored, then fires exactly once after a successful refetch", async () => {
      agentPrintersStatus = 500;
      const { queryClient } = renderPage();

      // Registry + agent info + scanners all settle; saved devices render.
      await screen.findByText("Zebra ZD421");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(0);

      // Printers recover; a refetch (same path as window-refocus/Retry)
      // succeeds -- NOW the reconcile fires, once.
      agentPrintersStatus = 200;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["agent", "printers"] });
      });

      await waitFor(() => expect(upsertCalls).toHaveLength(1));
      expect(upsertCalls[0].body).toMatchObject({
        seen_device_ids: ["dev-printer-live", "dev-scanner-com"],
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(1);
    });

    // Task 7 review finding 3 (TanStack v5): `isLoading` is
    // `isPending && isFetching`, so the pre-fetch window used to fall
    // through to DeviceCard's REAL empty-state markup instead of the
    // loading skeleton.
    it("shows the loading skeleton (never the empty-state copy) while the machine query is still pending", async () => {
      // Cached identity makes machineId resolve on the very first render,
      // so the machine query is enabled-and-fetching immediately.
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      server.use(
        http.get("http://api.test/api/equipment/machines/:machineId", async () => {
          await delay(80);
          return HttpResponse.json({ machine: machine(), devices: machineDevices });
        }),
      );
      renderPage();

      expect(await screen.findByTestId("equipment-registry-skeleton")).toBeInTheDocument();
      expect(screen.queryByText("No printers saved yet")).not.toBeInTheDocument();
      expect(screen.queryByText("No scanners saved yet")).not.toBeInTheDocument();

      expect(await screen.findByText("Zebra ZD421")).toBeInTheDocument();
    });

    it("renders the translated printer/scanner column titles and footers with no raw i18n keys leaking", async () => {
      renderPage();
      await screen.findByText("Zebra ZD421");

      expect(screen.getByText("Printers")).toBeInTheDocument();
      expect(screen.getByText("Scanners")).toBeInTheDocument();
      expect(
        screen.getByText("Default = what check-in stations on this computer use. One rule, stored on the server."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Saved devices persist on the server — a reload never empties this list."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/equipment[A-Z]/)).not.toBeInTheDocument();
    });
  });

  describe("legacy agent (connected_legacy)", () => {
    it("shows a live-only view (no registry) and does NOT fire a reconcile PUT", async () => {
      agentInfoStatus = 404; // pre-P4.3 agent: GET /info 404s.
      agentPrinters = [{ name: "Live_Only_Printer", type: "system" }];

      renderPage();

      expect(await screen.findByText("Update the agent to save devices to your organization")).toBeInTheDocument();
      // Live-only: the unregistered live printer shows as an unsaved row.
      expect(await screen.findByTestId("equipment-device-unsaved-Live_Only_Printer")).toBeInTheDocument();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(0);
    });

    // Task 7 review finding 5: a legacy agent (GET /info 404) on a machine
    // where a PRIOR modern connection already cached an identity. Pinned
    // intended behavior: the cached machine_id keeps the registry readable
    // (board 5d already requires saved devices visible with the agent fully
    // DOWN -- a reachable-but-legacy agent must never show LESS than a dead
    // one), the legacy update hint still renders, and the reconcile PUT
    // still never fires (only a live `info` may vouch for seen devices).
    it("with a cached identity: saved devices stay visible alongside the update hint, and still NO reconcile PUT", async () => {
      agentInfoStatus = 404;
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      machineDevices = [printerLive()];
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];

      renderPage();

      expect(await screen.findByText("Update the agent to save devices to your organization")).toBeInTheDocument();
      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      expect(within(row).getByText("Zebra ZD421")).toBeInTheDocument();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(0);
    });

    // PR #83 bot-review round 1, Finding 3: a legacy agent with NO cached
    // identity has machineId === null, so every Add/Set up/Save control's
    // handler (openCreateWizard/openCreateScannerWizard/onSaveUnsaved,
    // guarded in EquipmentPage.tsx) silently no-ops -- but the buttons
    // themselves used to render fully enabled, looking clickable while
    // doing nothing. The AgentCard's existing "Update the agent..." hint
    // already explains WHY (visible above); these controls must also be
    // disabled so the affordance itself is honest.
    it("with no cached identity: Add/Set up/Save controls are disabled (nothing honest to register into)", async () => {
      agentInfoStatus = 404;
      agentPrinters = [{ name: "Live_Only_Printer", type: "system" }];

      renderPage();

      expect(await screen.findByText("Update the agent to save devices to your organization")).toBeInTheDocument();
      const unsavedRow = await screen.findByTestId("equipment-device-unsaved-Live_Only_Printer");
      expect(within(unsavedRow).getByRole("button", { name: "Save…" })).toBeDisabled();

      const printersCard = screen.getByTestId("equipment-printers-card");
      expect(within(printersCard).getByRole("button", { name: "+ Set up printer" })).toBeDisabled();

      const scannersCard = screen.getByTestId("equipment-scanners-card");
      within(scannersCard)
        .getAllByRole("button", { name: "+ Set up scanner" })
        .forEach((button) => expect(button).toBeDisabled());

      expect(screen.getByRole("button", { name: "+ Add device" })).toBeDisabled();
    });

    // Counterpart: a cached identity from an EARLIER connection makes
    // machineId non-null even though the agent is currently legacy -- the
    // registry IS reachable, so these controls stay the real, enabled
    // affordance.
    it("with a cached identity: Add/Set up/Save controls stay enabled (machineId known from the cache)", async () => {
      agentInfoStatus = 404;
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      machineDevices = [printerLive()];
      agentPrinters = [
        { name: "HP_Smart_Tank_790", type: "system" }, // already registered -- printerLive()'s config.agent_name.
        { name: "Unregistered_Kitchen_Printer", type: "system" },
      ];

      renderPage();

      expect(await screen.findByText("Update the agent to save devices to your organization")).toBeInTheDocument();
      const unsavedRow = await screen.findByTestId("equipment-device-unsaved-Unregistered_Kitchen_Printer");
      expect(within(unsavedRow).getByRole("button", { name: "Save…" })).not.toBeDisabled();

      const printersCard = screen.getByTestId("equipment-printers-card");
      expect(within(printersCard).getByRole("button", { name: "+ Set up printer" })).not.toBeDisabled();

      const scannersCard = screen.getByTestId("equipment-scanners-card");
      within(scannersCard)
        .getAllByRole("button", { name: "+ Set up scanner" })
        .forEach((button) => expect(button).not.toBeDisabled());

      expect(screen.getByRole("button", { name: "+ Add device" })).not.toBeDisabled();
    });
  });

  describe("disconnected with cache (board 5d)", () => {
    beforeEach(() => {
      // Seed a prior successful connection's cached identity for this
      // agent base URL (agentInfoCache.ts's own storage key shape).
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      agentHealthOk = false;
      machineDevices = [printerLive(), printerNotSeen()];
    });

    it("shows the red card, Start-the-agent steps, Retry button, auto-retry caption, and still lists saved devices (grayed, actions hidden, saved · unreachable)", async () => {
      renderPage();

      expect(await screen.findByText("Agent not reachable")).toBeInTheDocument();
      expect(screen.getByText("auto-retry in 8 s")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();

      // Devices are still listed (fetched via the cached machine_id).
      const printersCard = await screen.findByTestId("equipment-printers-card");
      expect(within(printersCard).getByText("Zebra ZD421")).toBeInTheDocument();
      expect(printersCard).toHaveClass("opacity-55");
      expect(within(printersCard).getByTestId("equipment-printers-card-unreachable")).toHaveTextContent(
        "saved · unreachable",
      );

      // No action buttons on a grayed row (overflow menu / retry-live).
      const liveRow = within(printersCard).getByTestId("equipment-device-row-dev-printer-live");
      expect(within(liveRow).queryByRole("button")).not.toBeInTheDocument();

      // No reconcile PUT while the agent itself is unreachable.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(0);
    });
  });

  describe("disconnected without cache (cold start)", () => {
    it("renders no device cards at all", async () => {
      agentHealthOk = false;
      renderPage();

      expect(await screen.findByText("Agent not reachable")).toBeInTheDocument();
      expect(screen.queryByTestId("equipment-printers-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("equipment-scanners-card")).not.toBeInTheDocument();
    });
  });

  describe("empty registry (404)", () => {
    it("renders both columns' empty state with printer AND scanner setup both enabled (Task 8 + Task 9 -- the last wizard-todo placeholder is gone)", async () => {
      const user = userEvent.setup();
      machineStatus = 404;
      renderPage();

      const printersCard = await screen.findByTestId("equipment-printers-card");
      expect(within(printersCard).getByText("No printers saved yet")).toBeInTheDocument();
      const scannersCard = screen.getByTestId("equipment-scanners-card");
      expect(within(scannersCard).getByText("No scanners saved yet")).toBeInTheDocument();

      // Printer setup buttons (header + empty-state) are the REAL enabled
      // affordance -- no longer the disabled placeholder.
      within(printersCard)
        .getAllByRole("button", { name: "+ Set up printer" })
        .forEach((button) => expect(button).not.toBeDisabled());
      expect(within(printersCard).queryByTestId("wizard-todo")).not.toBeInTheDocument();

      // Scanner setup buttons (header + empty-state) are ALSO the real
      // enabled affordance now (Task 9) -- the disabled `wizard-todo`
      // placeholder is gone from this column too.
      within(scannersCard)
        .getAllByRole("button", { name: "+ Set up scanner" })
        .forEach((button) => expect(button).not.toBeDisabled());
      expect(within(scannersCard).queryByTestId("wizard-todo")).not.toBeInTheDocument();

      // The header "+ Add device" chooser: BOTH Printer and Scanner are
      // now the real enabled affordance -- no `wizard-todo` placeholder
      // survives anywhere on this page.
      await user.click(screen.getByRole("button", { name: "+ Add device" }));
      expect(await screen.findByRole("menuitem", { name: "Printer" })).not.toHaveAttribute("data-disabled");
      expect(screen.getByRole("menuitem", { name: "Scanner" })).not.toHaveAttribute("data-disabled");
      expect(screen.queryByTestId("wizard-todo")).not.toBeInTheDocument();

      // An empty registry still upserts the machine -- that's what
      // registers it.
      await waitFor(() => expect(upsertCalls).toHaveLength(1));

      // A true 404 is NOT an error state -- the two must stay distinct
      // (review finding 2's counterpart assertion).
      expect(screen.queryByTestId("equipment-registry-error")).not.toBeInTheDocument();
    });
  });

  describe("printer wizard entry points (Task 8)", () => {
    beforeEach(() => {
      machineDevices = [printerLive()];
      agentPrinters = [
        { name: "HP_Smart_Tank_790", type: "system" },
        { name: "Unregistered_Kitchen_Printer", type: "system" },
      ];
    });

    it("header '+ Add device' -> Printer opens the wizard at Find", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Zebra ZD421");
      await user.click(screen.getByRole("button", { name: "+ Add device" }));
      await user.click(await screen.findByRole("menuitem", { name: "Printer" }));

      expect(await screen.findByRole("dialog", { name: "Set up a printer" })).toBeInTheDocument();
      expect(screen.getByTestId("equipment-wizard-find-list")).toBeInTheDocument();
    });

    it("printers column '+ Set up printer' opens the wizard at Find, with already-registered printers excluded from its list", async () => {
      const user = userEvent.setup();
      renderPage();

      const printersCard = await screen.findByTestId("equipment-printers-card");
      await user.click(within(printersCard).getByRole("button", { name: "+ Set up printer" }));

      const dialog = await screen.findByRole("dialog", { name: "Set up a printer" });
      // Review fix round Minor 5 wiring: the saved row's agent_name
      // (HP_Smart_Tank_790, printerLive()'s config) is filtered out of the
      // wizard's Find list -- re-picking it would create a duplicate
      // registry row; the genuinely unregistered live printer stays.
      const findList = await within(dialog).findByTestId("equipment-wizard-find-list");
      expect(within(findList).getByRole("button", { name: /Unregistered_Kitchen_Printer/ })).toBeInTheDocument();
      expect(within(findList).queryByRole("button", { name: /HP_Smart_Tank_790/ })).not.toBeInTheDocument();
    });

    it("unsaved live printer's 'Save…' opens the wizard prefilled, straight at Test", async () => {
      const user = userEvent.setup();
      renderPage();

      const unsavedRow = await screen.findByTestId("equipment-device-unsaved-Unregistered_Kitchen_Printer");
      await user.click(within(unsavedRow).getByRole("button", { name: "Save…" }));

      expect(await screen.findByText("Did the test label print correctly?")).toBeInTheDocument();
      expect(screen.queryByTestId("equipment-wizard-find-list")).not.toBeInTheDocument();
    });

    it("a live saved printer row's 'Test print' opens the wizard in retest mode, straight at Test, with no Find step", async () => {
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: "Test print" }));

      expect(await screen.findByRole("dialog", { name: "Test print" })).toBeInTheDocument();
      expect(screen.getByText("Did the test label print correctly?")).toBeInTheDocument();
      expect(screen.queryByTestId("equipment-wizard-find-list")).not.toBeInTheDocument();
    });

    it("a not-seen (non-live) saved printer row has no 'Test print' button", async () => {
      machineDevices = [printerNotSeen()];
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      expect(within(row).queryByRole("button", { name: "Test print" })).not.toBeInTheDocument();
    });
  });

  describe("scanner wizard entry points (Task 9)", () => {
    it("header '+ Add device' -> Scanner opens ScannerWizard's kind toggle", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "+ Add device" }));
      await user.click(await screen.findByRole("menuitem", { name: "Scanner" }));

      expect(await screen.findByRole("dialog", { name: "Set up a scanner" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "USB / COM scanner" })).toBeInTheDocument();
    });

    it("scanners column '+ Set up scanner' opens ScannerWizard at the listen step", async () => {
      const user = userEvent.setup();
      renderPage();

      const scannersCard = await screen.findByTestId("equipment-scanners-card");
      // The empty scanners column renders "+ Set up scanner" twice (header
      // + empty-state button, same as the printers column) -- the header
      // one is first in DOM order.
      await user.click(within(scannersCard).getAllByRole("button", { name: "+ Set up scanner" })[0]);

      expect(await screen.findByRole("dialog", { name: "Set up a scanner" })).toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
    });

    it("a wedge scanner row's 'Test scan' opens the wizard in retest mode, straight at the listen step, no Save", async () => {
      machineDevices = [scannerWedge()];
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-scanner-wedge");
      await user.click(within(row).getByRole("button", { name: "Test scan" }));

      expect(await screen.findByRole("dialog", { name: "Test scan" })).toBeInTheDocument();
      expect(screen.getByTestId("scanner-wizard-listen-panel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save scanner" })).not.toBeInTheDocument();
    });

    it("a live com scanner row's 'Test scan' opens retest mode; a not-seen com scanner row has no 'Test scan' button", async () => {
      machineDevices = [scannerCom(), scannerCom({ id: "dev-scanner-com-notseen", config: { port_name: "COM9" } })];
      agentScanners = [{ name: "Symbol LS2208 (open)", port_name: "COM3" }];
      const user = userEvent.setup();
      renderPage();

      const liveRow = await screen.findByTestId("equipment-device-row-dev-scanner-com");
      await user.click(within(liveRow).getByRole("button", { name: "Test scan" }));
      expect(await screen.findByRole("dialog", { name: "Test scan" })).toBeInTheDocument();

      const notSeenRow = screen.getByTestId("equipment-device-row-dev-scanner-com-notseen");
      expect(within(notSeenRow).queryByRole("button", { name: "Test scan" })).not.toBeInTheDocument();
    });

    it("saving a new wedge scanner from the hub refreshes the registry list", async () => {
      const user = userEvent.setup();
      renderPage();

      const scannersCard = await screen.findByTestId("equipment-scanners-card");
      // The empty scanners column renders "+ Set up scanner" twice (header
      // + empty-state button, same as the printers column) -- the header
      // one is first in DOM order.
      await user.click(within(scannersCard).getAllByRole("button", { name: "+ Set up scanner" })[0]);

      const dialog = await screen.findByRole("dialog", { name: "Set up a scanner" });
      for (const char of "TEST-4471") fireEvent.keyDown(window, { key: char });
      fireEvent.keyDown(window, { key: "Enter" });
      await within(dialog).findByText("Scan received — TEST-4471");

      await user.type(within(dialog).getByLabelText("Device name"), "Honeywell Voyager — desk 2");
      machineDevices = [scannerWedge({ id: "dev-scanner-new", display_name: "Honeywell Voyager — desk 2" })];
      await user.click(within(dialog).getByRole("button", { name: "Save scanner" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(await screen.findByText("Honeywell Voyager — desk 2")).toBeInTheDocument();
    });

    it("deleting a saved com scanner best-effort calls removeComScanner with its port_name and does not block the delete on failure", async () => {
      machineDevices = [scannerCom()];
      removeComStatus = 500;
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-scanner-com");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(deleteCalls).toEqual(["dev-scanner-com"]));
      await waitFor(() => expect(removeComCalls).toEqual(["COM3"]));

      // The agent-side mirror failed, but the registry delete already
      // succeeded -- a visible, explicitly-dismissed warning, never a
      // blocked/undone delete.
      const warning = await screen.findByTestId("equipment-com-remove-warning");
      expect(warning).toHaveTextContent("couldn't release");
      await user.click(within(warning).getByRole("button", { name: "Close" }));
      expect(screen.queryByTestId("equipment-com-remove-warning")).not.toBeInTheDocument();
    });

    it("deleting a saved com scanner calls removeComScanner and shows no warning on success", async () => {
      machineDevices = [scannerCom()];
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-scanner-com");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(removeComCalls).toEqual(["COM3"]));
      expect(screen.queryByTestId("equipment-com-remove-warning")).not.toBeInTheDocument();
    });

    it("deleting a saved WEDGE scanner never calls removeComScanner (no agent-side port to release)", async () => {
      machineDevices = [scannerWedge()];
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-scanner-wedge");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(deleteCalls).toEqual(["dev-scanner-wedge"]));
      expect(removeComCalls).toEqual([]);
    });
  });

  // Task 7 review finding 2: a genuine (non-404) registry failure used to
  // render the exact same "No printers/scanners saved yet" screen as a
  // legitimately-never-registered machine -- the precise "silent empty
  // list" this phase's design exists to kill. It must render a distinct
  // error state with a retry affordance instead.
  describe("registry error (non-404)", () => {
    it("renders a distinct error state with Retry -- never the empty-state copy -- and fires no reconcile PUT", async () => {
      machineStatus = 500;
      renderPage();

      const errorBox = await screen.findByTestId("equipment-registry-error");
      expect(errorBox).toHaveTextContent("Couldn't load saved devices.");
      expect(within(errorBox).getByRole("button", { name: "Retry" })).toBeInTheDocument();

      expect(screen.queryByText("No printers saved yet")).not.toBeInTheDocument();
      expect(screen.queryByText("No scanners saved yet")).not.toBeInTheDocument();
      expect(screen.queryByTestId("equipment-printers-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("equipment-scanners-card")).not.toBeInTheDocument();

      // The reconcile gate treats a genuine error as not-settled: no upsert.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upsertCalls).toHaveLength(0);
    });

    it("Retry refetches the registry and renders the device columns once it recovers", async () => {
      machineStatus = 500;
      machineDevices = [printerLive()];
      const user = userEvent.setup();
      renderPage();

      const errorBox = await screen.findByTestId("equipment-registry-error");

      machineStatus = 200;
      await user.click(within(errorBox).getByRole("button", { name: "Retry" }));

      expect(await screen.findByTestId("equipment-printers-card")).toBeInTheDocument();
      expect(screen.getByText("Zebra ZD421")).toBeInTheDocument();
      expect(screen.queryByTestId("equipment-registry-error")).not.toBeInTheDocument();
    });
  });

  describe("overflow menu", () => {
    beforeEach(() => {
      machineDevices = [printerLive()];
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
    });

    it("rename: opens an inline dialog and PATCHes the new display name", async () => {
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

      const input = await screen.findByLabelText("Device name");
      await user.clear(input);
      await user.type(input, "Front Desk Zebra");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(patchCalls).toHaveLength(1));
      expect(patchCalls[0]).toMatchObject({
        deviceId: "dev-printer-live",
        body: { display_name: "Front Desk Zebra" },
      });
    });

    it("set default: PUTs the default-printer endpoint with this device's id, then best-effort mirrors the default onto the agent (Finding 8)", async () => {
      machineDevices = [printerLive({ is_default: false }), printerNotSeen({ is_default: true })];
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Make default" }));

      await waitFor(() => expect(defaultPrinterCalls).toHaveLength(1));
      expect(defaultPrinterCalls[0]).toMatchObject({
        machineId: "mach-1",
        body: { device_id: "dev-printer-live" },
      });

      // PR #83 bot-review round 2, Finding 8: the wizard's own Save path
      // already mirrors make_default onto the agent (PrinterWizard.tsx) --
      // the row-menu's own set-default action used to only write the
      // registry, leaving a legacy web reader of the agent's own
      // /printers/default stuck on the old value until SOME other action
      // happened to re-mirror it. printerLive()'s config.agent_name is
      // "HP_Smart_Tank_790".
      await waitFor(() => expect(agentDefaultCalls).toHaveLength(1));
      expect(agentDefaultCalls[0]).toEqual({ default: "HP_Smart_Tank_790" });
      expect(screen.queryByTestId("equipment-default-mirror-warning")).not.toBeInTheDocument();
    });

    // PR #83 bot-review round 2, Finding 8: warn-don't-fail, same idiom as
    // the wizard's own mirror failure (PrinterWizard.test.tsx's "mirror
    // failure" test) -- the registry write already committed and must
    // never be treated as failed just because the agent-side mirror was
    // rejected.
    it("set default: agent mirror failure shows a visible warning, but the registry write stands", async () => {
      machineDevices = [printerLive({ is_default: false }), printerNotSeen({ is_default: true })];
      agentDefaultStatus = 500;
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Make default" }));

      await waitFor(() => expect(defaultPrinterCalls).toHaveLength(1));
      await waitFor(() => expect(agentDefaultCalls).toHaveLength(1));

      const warning = await screen.findByTestId("equipment-default-mirror-warning");
      expect(warning).toBeInTheDocument();

      // The registry write is NOT rolled back -- exactly one PUT, still.
      expect(defaultPrinterCalls).toHaveLength(1);

      await user.click(within(warning).getByRole("button", { name: "Close" }));
      expect(screen.queryByTestId("equipment-default-mirror-warning")).not.toBeInTheDocument();
    });

    // PR #83 bot-review round 2, Finding 8: the agent's own reachability is
    // already tracked at the hub level (AgentCard shows it prominently) --
    // attempting (and failing) a mirror call against a known-unreachable
    // agent would just be noise on top of that, so the mirror is skipped
    // outright rather than attempted-then-warned. Exercised via the
    // "checking" (mid-probe) state rather than "disconnected": DeviceCard
    // hides the ENTIRE row-menu whenever its `agentDown` prop is true (see
    // DeviceCard.tsx's `{!agentDown ? (...) : null}` row-actions gate), so
    // "Make default" can never actually be clicked while truly
    // disconnected -- "checking" is the one state where the row-menu is
    // still rendered (agentDown is strictly `state === "disconnected"`)
    // AND the agent isn't yet known-reachable, making it the genuinely
    // reachable representative of this guard. A cached identity (same
    // seeding idiom as the "disconnected with cache" describe block above)
    // supplies `machineId` so the registry renders without waiting on the
    // live probe; GET /health is held open so `state` never leaves
    // "checking" during the click.
    it("set default: agent not yet known-reachable (checking) -- skips the mirror gracefully, no POST and no warning", async () => {
      machineDevices = [printerLive({ is_default: false }), printerNotSeen({ is_default: true })];
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      server.use(
        http.get("http://agent.test/health", async () => {
          await delay("infinite");
          return new HttpResponse(null, { status: 200 });
        }),
      );
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Make default" }));

      await waitFor(() => expect(defaultPrinterCalls).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(agentDefaultCalls).toHaveLength(0);
      expect(screen.queryByTestId("equipment-default-mirror-warning")).not.toBeInTheDocument();
    });

    // Task 7 review finding 4: the clear path (is_default row -> PUT
    // device_id: null) was implemented but unproven.
    it("clear default: PUTs the default-printer endpoint with device_id null from the default row's menu", async () => {
      const user = userEvent.setup();
      renderPage();

      // printerLive() is the default row, so its menu offers Clear default.
      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Clear default" }));

      await waitFor(() => expect(defaultPrinterCalls).toHaveLength(1));
      expect(defaultPrinterCalls[0]).toMatchObject({
        machineId: "mach-1",
        body: { device_id: null },
      });
    });

    it("delete: opens a confirm dialog and DELETEs on confirm", async () => {
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

      expect(await screen.findByText(/Delete Zebra ZD421\?/)).toBeInTheDocument();
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(deleteCalls).toEqual(["dev-printer-live"]));
    });
  });

  // The 2026-07-20 Zebra run's gap: a network printer's ip/port was only
  // editable by DELETING and recreating the device. The row menu's "Edit
  // address…" (network printers only) PATCHes config -- preserving
  // agent_name (the stable agent-side link) and dpi -- then best-effort
  // mirrors the change onto the agent as remove-THEN-add under the same
  // name (see agentPrinterMirrorCalls' own comment for why a bare re-add
  // would be dishonest). The backend clears test_passed_at on any
  // config-changing PATCH (PR #83 round 2), so the dialog copy must surface
  // the re-test consequence.
  describe("edit address (network printers)", () => {
    beforeEach(() => {
      machineDevices = [
        printerLive(),
        // dpi included to prove the PATCH preserves config keys it does not
        // edit (agent_name and dpi both survive the ip/port swap verbatim).
        printerNotSeen({ config: { agent_name: "Godex_G500", ip: "10.0.0.5", port: 9100, dpi: 300 } }),
        scannerWedge(),
      ];
      agentPrinters = [{ name: "HP_Smart_Tank_790", type: "system" }];
    });

    it("offers 'Edit address…' only on network printer rows -- not system printers, not scanners", async () => {
      const user = userEvent.setup();
      renderPage();

      const networkRow = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(networkRow).getByRole("button", { name: /More actions/ }));
      expect(await screen.findByRole("menuitem", { name: "Edit address…" })).toBeInTheDocument();
      await user.keyboard("{Escape}");

      const systemRow = screen.getByTestId("equipment-device-row-dev-printer-live");
      await user.click(within(systemRow).getByRole("button", { name: /More actions/ }));
      expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit address…" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");

      const wedgeRow = screen.getByTestId("equipment-device-row-dev-scanner-wedge");
      await user.click(within(wedgeRow).getByRole("button", { name: /More actions/ }));
      expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit address…" })).not.toBeInTheDocument();
    });

    it("opens prefilled with the saved ip/port, surfaces the re-test consequence, PATCHes config with agent_name/dpi preserved, then mirrors remove-then-add onto the agent", async () => {
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      const portInput = within(dialog).getByLabelText("Port");
      expect(ipInput).toHaveValue("10.0.0.5");
      expect(portInput).toHaveValue(9100);
      // The config-change consequence (test_passed_at reset server-side)
      // must be readable BEFORE the operator commits.
      expect(within(dialog).getByText(/clears this printer's test status/)).toBeInTheDocument();

      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");
      await user.clear(portInput);
      await user.type(portInput, "6101");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(patchCalls).toHaveLength(1));
      expect(patchCalls[0]).toEqual({
        deviceId: "dev-printer-notseen",
        // config-only PATCH (no display_name), with agent_name and dpi
        // carried over verbatim -- only ip/port change.
        body: { config: { agent_name: "Godex_G500", ip: "10.0.0.77", port: 6101, dpi: 300 } },
      });

      // The agent mirror: remove FIRST, then add with the new address --
      // both keyed by the unchanged agent_name, never display_name.
      await waitFor(() =>
        expect(agentPrinterMirrorCalls).toEqual([
          { op: "remove", body: { name: "Godex_G500" } },
          { op: "add", body: { name: "Godex_G500", ip: "10.0.0.77", port: 6101 } },
        ]),
      );

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByTestId("equipment-address-mirror-warning")).not.toBeInTheDocument();
    });

    // Codex PR #85 review, Finding 2: Save used to stay enabled even with
    // the prefilled (unchanged) address, so a no-op click still ran the
    // registry PATCH AND the remove-then-add agent mirror -- a real risk,
    // since a transient add failure AFTER a successful remove would delete
    // a previously-working network printer from the agent for NO reason
    // (nothing needed mirroring in the first place). Save now requires the
    // address to actually differ from the saved config, on top of the
    // wizard's own port-range rule.
    it("Save stays disabled while the address is unchanged from the saved config, or the ip is empty, or the port is outside 1..65535", async () => {
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      const portInput = within(dialog).getByLabelText("Port");
      const save = within(dialog).getByRole("button", { name: "Save" });
      // Nothing edited yet -- the prefilled address matches the saved
      // config exactly, so there is nothing honest to save.
      expect(save).toBeDisabled();

      await user.clear(portInput);
      await user.type(portInput, "6101");
      expect(save).not.toBeDisabled();

      // Edited BACK to the original port -- the address matches the saved
      // config again, so Save goes back to disabled.
      await user.clear(portInput);
      await user.type(portInput, "9100");
      expect(save).toBeDisabled();

      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");
      expect(save).not.toBeDisabled();

      await user.clear(portInput);
      expect(save).toBeDisabled();
      await user.type(portInput, "70000");
      expect(save).toBeDisabled();
      await user.clear(portInput);
      await user.type(portInput, "6101");
      expect(save).not.toBeDisabled();

      await user.clear(ipInput);
      expect(save).toBeDisabled();

      expect(patchCalls).toHaveLength(0);
    });

    it("agent remove failure: warns visibly (dismissable), never attempts the add, and the registry PATCH stands", async () => {
      removePrinterStatus = 500;
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(patchCalls).toHaveLength(1));
      // The chain short-circuits: a failed remove must NOT be followed by an
      // add (adding while the stale config entry survives is exactly the
      // silently-reverts-on-restart state the sequence exists to avoid).
      const warning = await screen.findByTestId("equipment-address-mirror-warning");
      expect(warning).toHaveTextContent("couldn't apply");
      expect(agentPrinterMirrorCalls).toEqual([{ op: "remove", body: { name: "Godex_G500" } }]);
      // Warn, don't fail: the PATCH is not rolled back or retried.
      expect(patchCalls).toHaveLength(1);

      await user.click(within(warning).getByRole("button", { name: "Close" }));
      expect(screen.queryByTestId("equipment-address-mirror-warning")).not.toBeInTheDocument();
    });

    it("agent add failure after a successful remove: both calls recorded, warning shown, PATCH stands", async () => {
      addPrinterStatus = 500;
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(patchCalls).toHaveLength(1));
      const warning = await screen.findByTestId("equipment-address-mirror-warning");
      expect(warning).toHaveTextContent("couldn't apply");
      expect(agentPrinterMirrorCalls).toEqual([
        { op: "remove", body: { name: "Godex_G500" } },
        { op: "add", body: { name: "Godex_G500", ip: "10.0.0.77", port: 9100 } },
      ]);
      expect(patchCalls).toHaveLength(1);
    });

    // Same guard shape as "set default: agent not yet known-reachable" above
    // -- the one state where the row menu still renders but the agent is not
    // yet known-reachable is "checking" (held-open /health probe + cached
    // identity), and the mirror must be skipped outright, not
    // attempted-then-warned.
    it("agent not yet known-reachable (checking): PATCHes the registry but skips the mirror -- no agent calls, no warning", async () => {
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      server.use(
        http.get("http://agent.test/health", async () => {
          await delay("infinite");
          return new HttpResponse(null, { status: 200 });
        }),
      );
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(patchCalls).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(agentPrinterMirrorCalls).toEqual([]);
      expect(screen.queryByTestId("equipment-address-mirror-warning")).not.toBeInTheDocument();
    });

    // Codex PR #85 review, Finding 3: PrinterWizard's own manual-add path
    // (handleManualSubmit) invalidates AGENT_PRINTERS_KEY right after a
    // successful agentClient.addNetworkPrinter -- the edit-address mirror's
    // own successful add must do the same, or the hub's live-printer list
    // stays stale (amber/not_seen, "Test print" hidden) until an unrelated
    // refetch (window refocus, manual Retry) happens to fire.
    it("a successful address mirror refreshes the cached live-printers list", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Zebra ZD421");
      const fetchesBeforeSave = agentPrintersFetchCount;

      const row = screen.getByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(agentPrinterMirrorCalls).toEqual([
          { op: "remove", body: { name: "Godex_G500" } },
          { op: "add", body: { name: "Godex_G500", ip: "10.0.0.77", port: 9100 } },
        ]),
      );
      await waitFor(() => expect(agentPrintersFetchCount).toBeGreaterThan(fetchesBeforeSave));
    });
  });

});
