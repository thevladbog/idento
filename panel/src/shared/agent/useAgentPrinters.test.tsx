import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAgentPrinters } from "./useAgentPrinters";
import { startMswServer } from "../../test/msw";

let printersResponse: Array<{ name: string; type: string }> = [];
let defaultResponse: { default: string | null } = { default: null };
let healthOk = true;
let requestCounts = { health: 0, printers: 0, default: 0, info: 0, machine: 0 };

// P4.3 Task 10: agent GET /info + the equipment registry GET, so
// useAgentPrinters' internal useAgentInfo()/useEquipmentMachine() calls
// have something to hit. Defaults to a "legacy agent" baseline (GET /info
// 404s, per agentClient.getInfo's contract) so every test ABOVE the new
// "registry default precedence" describe block below -- none of which sets
// these -- exercises the exact pre-Task-10 path: useAgentInfo resolves
// info=null, useEquipmentMachine's own `enabled` gate never fires (its
// machineId stays null), and registryDefaultAgentName is therefore always
// null -- configuredDefault collapses straight to the agent's own
// GET /printers/default value, byte-identical to before this task.
let agentInfoStatus: 200 | 404 = 404;
let agentInfoResponse = { machine_id: "mach-1", hostname: "REG-DESK-01", version: "1.9.0", uptime_seconds: 100 };
let machineStatus: 200 | 404 | 500 = 404;
let machineDevices: Array<Record<string, unknown>> = [];

const server = startMswServer(
  http.get("http://agent.test/health", () => {
    requestCounts.health += 1;
    return healthOk ? new HttpResponse(null, { status: 200 }) : HttpResponse.error();
  }),
  http.get("http://agent.test/printers", () => {
    requestCounts.printers += 1;
    return HttpResponse.json(printersResponse);
  }),
  http.get("http://agent.test/printers/default", () => {
    requestCounts.default += 1;
    return HttpResponse.json(defaultResponse);
  }),
  http.get("http://agent.test/info", () => {
    requestCounts.info += 1;
    if (agentInfoStatus === 404) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(agentInfoResponse);
  }),
  http.get("http://api.test/api/equipment/machines/:machineId", () => {
    requestCounts.machine += 1;
    if (machineStatus !== 200) return new HttpResponse(null, { status: machineStatus });
    return HttpResponse.json({
      machine: {
        machine_id: "mach-1",
        hostname: "REG-DESK-01",
        agent_version: "1.9.0",
        last_seen_at: "2026-07-19T00:00:00Z",
        created_at: "2026-07-01T00:00:00Z",
      },
      devices: machineDevices,
    });
  }),
);
// startMswServer's return value matters for its listen/reset/close
// lifecycle side effects (registered via beforeAll/afterEach/afterAll), and
// (PR #74 review round Fix 7) for the one test below that needs a per-test
// `server.use()` override -- a single endpoint failing independently of the
// mutable response variables above (which all resolve 200).
void server;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useAgentPrinters", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    printersResponse = [];
    defaultResponse = { default: null };
    healthOk = true;
    requestCounts = { health: 0, printers: 0, default: 0, info: 0, machine: 0 };
    agentInfoStatus = 404;
    agentInfoResponse = { machine_id: "mach-1", hostname: "REG-DESK-01", version: "1.9.0", uptime_seconds: 100 };
    machineStatus = 404;
    machineDevices = [];
  });

  it("is disconnected and fetches nothing while disabled", () => {
    const { result } = renderHook(() => useAgentPrinters(false), { wrapper });
    expect(result.current).toEqual({
      state: "disconnected",
      printers: [],
      defaultPrinter: null,
      configuredDefault: null,
      refetch: expect.any(Function),
    });
    expect(requestCounts.health).toBe(0);
  });

  it("reports checking synchronously, then connected with the printer list + default once resolved", async () => {
    printersResponse = [
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ];
    defaultResponse = { default: "HP_Smart_Tank_790_series" };

    const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
    expect(result.current.state).toBe("checking");

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.printers).toEqual([
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ]);
    expect(result.current.defaultPrinter).toBe("HP_Smart_Tank_790_series");
  });

  it("falls back to the first printer when the configured default is not in the current list (web parity)", async () => {
    printersResponse = [
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ];
    defaultResponse = { default: "Unplugged_Old_Printer" };

    const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.defaultPrinter).toBe("HP_Smart_Tank_790_series");
  });

  it("reports disconnected with no printers/default when the agent is unreachable", async () => {
    healthOk = false;
    const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("disconnected"));
    expect(result.current.printers).toEqual([]);
    expect(result.current.defaultPrinter).toBeNull();
    // Health-gated: no point listing printers once the agent has already
    // failed its health check.
    expect(requestCounts.printers).toBe(0);
  });

  it("reports null defaultPrinter (not the first entry) when there are no printers at all", async () => {
    printersResponse = [];
    defaultResponse = { default: null };
    const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.printers).toEqual([]);
    expect(result.current.defaultPrinter).toBeNull();
  });

  // P3.2 Task 8: `configuredDefault` must stay the RAW agent value (null
  // here — no default is configured) even though `defaultPrinter` applies
  // its own "always have a preselection" fallback to the first printer.
  // Consumers that need to know "should I ask the operator to choose"
  // (the drawer's Reprint confirm) rely on this NOT silently inheriting
  // the fallback the way `defaultPrinter` deliberately does.
  it("keeps configuredDefault null (distinct from defaultPrinter's fallback) when the agent has printers but no default configured", async () => {
    printersResponse = [
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ];
    defaultResponse = { default: null };
    const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.defaultPrinter).toBe("HP_Smart_Tank_790_series");
    expect(result.current.configuredDefault).toBeNull();
  });

  // PR #74 review round Fix 7: GET /printers/default used to be
  // `Promise.all`'d alongside GET /printers, so its failure (agent
  // implements /printers but errors on /printers/default -- a genuinely
  // observed real-agent quirk, not hypothetical) rejected the WHOLE query,
  // reporting the agent as fully "disconnected" even though the printer
  // list itself loaded fine and printing via an explicit choice is still
  // perfectly usable. The default lookup's failure must degrade to
  // `configuredDefault: null` (same shape as "no default configured") --
  // never take down connectivity/the printer list with it.
  it("degrades to configuredDefault: null (not disconnected) when only the default-printer lookup fails", async () => {
    printersResponse = [
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ];
    server.use(
      http.get("http://agent.test/printers/default", () => new HttpResponse(null, { status: 500 })),
    );

    const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.printers).toEqual([
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ]);
    expect(result.current.configuredDefault).toBeNull();
    // `defaultPrinter` still falls back to the first printer -- the
    // operator isn't left with no preselection just because the agent
    // couldn't report ITS OWN configured default.
    expect(result.current.defaultPrinter).toBe("HP_Smart_Tank_790_series");
  });

  // P4.3 Task 10 (spec decision 2): the equipment registry's own default
  // printer (set via the hub) now outranks the agent's own configured
  // default. `registryPrinterDevice` mirrors EquipmentPage.test.tsx's
  // `printerLive()` shape (models.EquipmentDevice) -- only `is_default`,
  // `class`, and `config.agent_name` are actually read by the hook, but the
  // full shape keeps this realistic.
  describe("registry default precedence (server registry > agent config > null)", () => {
    function registryPrinterDevice(overrides: Record<string, unknown> = {}) {
      return {
        id: "dev-printer-1",
        class: "printer",
        kind: "system",
        display_name: "Registry Printer",
        config: { agent_name: "Server_Registry_Printer" },
        is_default: true,
        test_passed_at: null,
        last_seen_at: "2026-07-19T00:00:00Z",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
        ...overrides,
      };
    }

    it("server default wins over the agent's own configured default when its agent_name is in the live printer list", async () => {
      agentInfoStatus = 200;
      machineStatus = 200;
      machineDevices = [registryPrinterDevice()];
      printersResponse = [
        { name: "Server_Registry_Printer", type: "system" },
        { name: "Agent_Own_Default", type: "system" },
      ];
      defaultResponse = { default: "Agent_Own_Default" };

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      // Waits for the registry fetch to settle and win -- the pre-settle
      // value (null, then "Agent_Own_Default" once only the printers query
      // has resolved) is never "Server_Registry_Printer" on its own, so
      // this can't pass before the server-wins logic actually runs.
      await waitFor(() => expect(result.current.configuredDefault).toBe("Server_Registry_Printer"));
      expect(result.current.defaultPrinter).toBe("Server_Registry_Printer");
    });

    it("falls back to the agent's configured default when the server default's agent_name is not in the live printer list", async () => {
      agentInfoStatus = 200;
      machineStatus = 200;
      machineDevices = [registryPrinterDevice({ config: { agent_name: "Unplugged_Registry_Printer" } })];
      printersResponse = [{ name: "Agent_Own_Default", type: "system" }];
      defaultResponse = { default: "Agent_Own_Default" };

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      await waitFor(() => expect(requestCounts.machine).toBeGreaterThan(0));
      expect(result.current.configuredDefault).toBe("Agent_Own_Default");
      expect(result.current.defaultPrinter).toBe("Agent_Own_Default");
    });

    it("falls back to the agent's configured default (byte-identical legacy behavior) when the machine has no registry entry (404)", async () => {
      agentInfoStatus = 200; // agent reports identity fine...
      machineStatus = 404; // ...but this (tenant, machine_id) was never registered in the hub.
      printersResponse = [{ name: "Agent_Own_Default", type: "system" }];
      defaultResponse = { default: "Agent_Own_Default" };

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      await waitFor(() => expect(requestCounts.machine).toBeGreaterThan(0));
      expect(result.current.configuredDefault).toBe("Agent_Own_Default");
      expect(result.current.defaultPrinter).toBe("Agent_Own_Default");
    });

    it("falls back to the agent's configured default (byte-identical legacy behavior) when the agent is pre-P4.3 (GET /info 404s)", async () => {
      agentInfoStatus = 404; // legacy agent: no identity, so machine_id is never known.
      printersResponse = [{ name: "Agent_Own_Default", type: "system" }];
      defaultResponse = { default: "Agent_Own_Default" };

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      await waitFor(() => expect(requestCounts.info).toBeGreaterThan(0));
      expect(result.current.configuredDefault).toBe("Agent_Own_Default");
      expect(result.current.defaultPrinter).toBe("Agent_Own_Default");
      // useEquipmentMachine's own `enabled` gate never fires without a
      // known machine_id -- the registry is never even queried.
      expect(requestCounts.machine).toBe(0);
    });

    it("falls back to the agent's configured default (byte-identical legacy behavior) when the machine registry query itself errors", async () => {
      agentInfoStatus = 200;
      machineStatus = 500; // a genuine registry failure, distinct from the empty-registry 404 case above.
      printersResponse = [{ name: "Agent_Own_Default", type: "system" }];
      defaultResponse = { default: "Agent_Own_Default" };

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      await waitFor(() => expect(requestCounts.machine).toBeGreaterThan(0));
      expect(result.current.configuredDefault).toBe("Agent_Own_Default");
      expect(result.current.defaultPrinter).toBe("Agent_Own_Default");
    });

    // Task 10 review round: the identity/registry chain must start
    // CONCURRENTLY with the printers probe at mount, never serialized
    // behind it -- a printers-gated start would lengthen the window where
    // `configuredDefault` still reflects only the agent's own default after
    // printers/state have already settled (AttendeeDrawer/BulkBar read
    // `configuredDefault` live, every render, to decide ask-vs-don't-ask).
    // Holds the /printers response open (same deferred-promise idiom as
    // StationPage.test.tsx's waiting-for-printer test) and asserts the
    // machines endpoint is reached WHILE printers is still pending.
    it("starts the identity/registry lookups concurrently with the printers probe, not serially after it resolves", async () => {
      agentInfoStatus = 200;
      machineStatus = 200;
      machineDevices = [registryPrinterDevice()];
      defaultResponse = { default: "Agent_Own_Default" };
      let releasePrinters: (() => void) | undefined;
      const printersGate = new Promise<void>((resolve) => {
        releasePrinters = resolve;
      });
      server.use(
        http.get("http://agent.test/printers", async () => {
          await printersGate;
          return HttpResponse.json([
            { name: "Server_Registry_Printer", type: "system" },
            { name: "Agent_Own_Default", type: "system" },
          ]);
        }),
      );

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      // Both registry-chain endpoints are reached while the printers query
      // is still pending -- proof the chain is printers-independent.
      await waitFor(() => expect(requestCounts.info).toBeGreaterThan(0));
      await waitFor(() => expect(requestCounts.machine).toBeGreaterThan(0));
      expect(result.current.state).toBe("checking");

      releasePrinters?.();
      await waitFor(() => expect(result.current.state).toBe("connected"));
      // With both settled, the registry default wins immediately.
      await waitFor(() => expect(result.current.configuredDefault).toBe("Server_Registry_Printer"));
    });

    // Drawer-reprint contract (P3.2 Task 8's comment on `configuredDefault`
    // above): a non-null `configuredDefault` means AttendeeDrawer's Reprint
    // confirm does NOT ask the operator to choose. A registry default must
    // hold that contract even when the agent itself has no opinion.
    it("keeps configuredDefault non-null (drawer-reprint contract) when the server has a default but the agent's own default is unset", async () => {
      agentInfoStatus = 200;
      machineStatus = 200;
      machineDevices = [registryPrinterDevice()];
      printersResponse = [{ name: "Server_Registry_Printer", type: "system" }];
      defaultResponse = { default: null };

      const { result } = renderHook(() => useAgentPrinters(true), { wrapper });
      await waitFor(() => expect(result.current.state).toBe("connected"));
      await waitFor(() => expect(result.current.configuredDefault).toBe("Server_Registry_Printer"));
      expect(result.current.configuredDefault).not.toBeNull();
    });
  });
});
