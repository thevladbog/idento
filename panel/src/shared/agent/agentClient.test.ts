import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { agentClient, AgentPrintTimeoutError } from "./agentClient";
import { startMswServer } from "../../test/msw";

// The agent is a separate origin from the backend API (not in
// backend/openapi.yaml, not behind `$api`) — handlers live on their own
// http://agent.test origin, matching the AGENT_URL seeded in window.__ENV__
// below (see getAgentBaseUrl, shared/api/http.ts).
const server = startMswServer(
  http.get("http://agent.test/health", () => new HttpResponse(null, { status: 200 })),
  http.get("http://agent.test/printers", () =>
    HttpResponse.json([
      { name: "HP_Smart_Tank_790_series", type: "system" },
      { name: "Network_192_168_0_245", type: "network" },
    ]),
  ),
  http.get("http://agent.test/printers/default", () =>
    HttpResponse.json({ default: "HP_Smart_Tank_790_series" }),
  ),
  http.get("http://agent.test/scanners", () =>
    HttpResponse.json([{ name: "Scanner_COM3", port_name: "COM3" }]),
  ),
  http.get("http://agent.test/scanners/ports", () =>
    HttpResponse.json([
      { port_name: "COM3", display_name: "COM3", device_type: "serial", transport: "usb" },
      { port_name: "COM4" },
    ]),
  ),
  http.post("http://agent.test/scanners/add", () =>
    HttpResponse.json({ status: "added", name: "Scanner_COM3", port: "COM3" }),
  ),
  http.post("http://agent.test/scanners/remove", () =>
    HttpResponse.json({ status: "removed", name: "Scanner_COM3", port: "COM3" }),
  ),
  http.post("http://agent.test/print", () => HttpResponse.json({ status: "printed" })),
  http.post("http://agent.test/printers/add", () =>
    HttpResponse.json({ status: "added", name: "Network_Office", address: "192.168.0.245:9100" }, { status: 201 }),
  ),
  http.post("http://agent.test/printers/default", () => HttpResponse.json({ default: "Network_Office" })),
  http.post("http://agent.test/scan/consume", () =>
    HttpResponse.json({ code: "", time: "0001-01-01T00:00:00Z" }),
  ),
  http.get("http://agent.test/info", () =>
    HttpResponse.json({
      machine_id: "mach-abc123",
      hostname: "kiosk-07",
      version: "1.4.0",
      uptime_seconds: 3600,
    }),
  ),
);

describe("agentClient", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
  });

  describe("checkHealth", () => {
    it("resolves true when GET /health responds 200", async () => {
      await expect(agentClient.checkHealth()).resolves.toBe(true);
    });

    it("resolves false (never rejects) when the agent is unreachable", async () => {
      server.use(http.get("http://agent.test/health", () => HttpResponse.error()));
      await expect(agentClient.checkHealth()).resolves.toBe(false);
    });

    it("resolves false when the response is slower than timeoutMs, without waiting for it", async () => {
      server.use(
        http.get("http://agent.test/health", async () => {
          await delay(300);
          return new HttpResponse(null, { status: 200 });
        }),
      );
      const start = Date.now();
      await expect(agentClient.checkHealth(30)).resolves.toBe(false);
      expect(Date.now() - start).toBeLessThan(200);
    });

    it("resolves false on a non-2xx response", async () => {
      server.use(http.get("http://agent.test/health", () => new HttpResponse(null, { status: 500 })));
      await expect(agentClient.checkHealth()).resolves.toBe(false);
    });
  });

  describe("getPrinters", () => {
    it("returns the printer list with type narrowed to system|network", async () => {
      await expect(agentClient.getPrinters()).resolves.toEqual([
        { name: "HP_Smart_Tank_790_series", type: "system" },
        { name: "Network_192_168_0_245", type: "network" },
      ]);
    });

    it("throws on a non-2xx response", async () => {
      server.use(http.get("http://agent.test/printers", () => new HttpResponse(null, { status: 500 })));
      await expect(agentClient.getPrinters()).rejects.toThrow();
    });
  });

  // P4.3 Task 6 -- the equipment hub's com-scanner liveness signal
  // (agent/openapi.yaml GET /scanners, tag "Scanners"). Mirrors getPrinters'
  // shape/error tests; no type-narrowing here since GET /scanners only ever
  // reports com scanners the agent has opened.
  describe("getScanners", () => {
    it("returns the open com scanner list", async () => {
      await expect(agentClient.getScanners()).resolves.toEqual([{ name: "Scanner_COM3", port_name: "COM3" }]);
    });

    it("returns an empty array when the agent has no com scanner open", async () => {
      server.use(http.get("http://agent.test/scanners", () => HttpResponse.json([])));
      await expect(agentClient.getScanners()).resolves.toEqual([]);
    });

    it("throws on a non-2xx response", async () => {
      server.use(http.get("http://agent.test/scanners", () => new HttpResponse(null, { status: 500 })));
      await expect(agentClient.getScanners()).rejects.toThrow();
    });
  });

  // P4.3 Task 9 -- the scanner wizard's COM port picker (agent/openapi.yaml
  // GET /scanners/ports, tag "Scanners"). Narrows the agent's richer
  // response (optional USB metadata per port) down to just the port_name
  // strings this app actually uses -- same idiom as getPrinters' type
  // narrowing.
  describe("getScannerPorts", () => {
    it("returns just the port_name strings, discarding the optional USB metadata", async () => {
      await expect(agentClient.getScannerPorts()).resolves.toEqual(["COM3", "COM4"]);
    });

    it("returns an empty array when the agent finds no ports (not an error)", async () => {
      server.use(http.get("http://agent.test/scanners/ports", () => HttpResponse.json([])));
      await expect(agentClient.getScannerPorts()).resolves.toEqual([]);
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(
        http.get("http://agent.test/scanners/ports", () => new HttpResponse("agent misconfigured", { status: 500 })),
      );
      await expect(agentClient.getScannerPorts()).rejects.toThrow(/agent misconfigured/);
    });
  });

  // P4.3 Task 9 -- the wizard's COM path: pick a port, open it agent-side
  // (agent/openapi.yaml POST /scanners/add, tag "Scanners", body
  // `ScannerRequest` = {port_name}).
  describe("addComScanner", () => {
    it("POSTs {port_name} to /scanners/add and resolves void on 200", async () => {
      let captured: unknown;
      server.use(
        http.post("http://agent.test/scanners/add", async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ status: "added", name: "Scanner_COM3", port: "COM3" });
        }),
      );
      await expect(agentClient.addComScanner("COM3")).resolves.toBeUndefined();
      expect(captured).toEqual({ port_name: "COM3" });
    });

    it("sends Content-Type: application/json (required by the agent's Origin-allowlist auth for mutations)", async () => {
      let capturedContentType: string | null = null;
      server.use(
        http.post("http://agent.test/scanners/add", ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json({ status: "added", name: "Scanner_COM3", port: "COM3" });
        }),
      );
      await agentClient.addComScanner("COM3");
      expect(capturedContentType).toBe("application/json");
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(
        http.post("http://agent.test/scanners/add", () => new HttpResponse("port_name is required", { status: 400 })),
      );
      await expect(agentClient.addComScanner("")).rejects.toThrow(/port_name is required/);
    });
  });

  // P4.3 Task 9 -- the equipment hub's best-effort mirror cleanup when a
  // saved kind=com device is deleted (EquipmentPage.tsx). Same ScannerRequest
  // body shape as addComScanner -- confirmed against agent/openapi.yaml,
  // POST /scanners/remove takes {port_name} only, never a separate "name"
  // identifier.
  describe("removeComScanner", () => {
    it("POSTs {port_name} to /scanners/remove and resolves void on 200", async () => {
      let captured: unknown;
      server.use(
        http.post("http://agent.test/scanners/remove", async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ status: "removed", name: "Scanner_COM3", port: "COM3" });
        }),
      );
      await expect(agentClient.removeComScanner("COM3")).resolves.toBeUndefined();
      expect(captured).toEqual({ port_name: "COM3" });
    });

    // The endpoint is documented as idempotent (200 even when the port was
    // never open) -- this client just passes that 200 straight through as
    // a normal resolve, no special-casing needed.
    it("resolves void on 200 even when the agent reports the port was already absent", async () => {
      server.use(
        http.post("http://agent.test/scanners/remove", () => HttpResponse.json({ status: "removed" })),
      );
      await expect(agentClient.removeComScanner("COM9")).resolves.toBeUndefined();
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(
        http.post("http://agent.test/scanners/remove", () => new HttpResponse("port_name is required", { status: 400 })),
      );
      await expect(agentClient.removeComScanner("")).rejects.toThrow(/port_name is required/);
    });
  });

  describe("getDefaultPrinter", () => {
    it("returns the configured default printer name", async () => {
      await expect(agentClient.getDefaultPrinter()).resolves.toBe("HP_Smart_Tank_790_series");
    });

    it("returns null when no default is configured", async () => {
      server.use(
        http.get("http://agent.test/printers/default", () => HttpResponse.json({ default: null })),
      );
      await expect(agentClient.getDefaultPrinter()).resolves.toBeNull();
    });

    it("throws on a non-2xx response", async () => {
      server.use(http.get("http://agent.test/printers/default", () => new HttpResponse(null, { status: 500 })));
      await expect(agentClient.getDefaultPrinter()).rejects.toThrow();
    });
  });

  describe("print", () => {
    it("resolves without throwing on 200 — the body is a transport ack, not print confirmation", async () => {
      await expect(
        agentClient.print({ printer_name: "HP_Smart_Tank_790_series", zpl: "^XA^XZ" }),
      ).resolves.toBeUndefined();
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(
        http.post("http://agent.test/print", () => new HttpResponse("printer not found", { status: 404 })),
      );
      await expect(
        agentClient.print({ printer_name: "missing", zpl: "^XA^XZ" }),
      ).rejects.toThrow(/printer not found/);
    });

    it("sends Content-Type: application/json (required by the agent's Origin-allowlist auth for mutations)", async () => {
      let capturedContentType: string | null = null;
      server.use(
        http.post("http://agent.test/print", ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json({ status: "printed" });
        }),
      );
      await agentClient.print({ printer_name: "HP_Smart_Tank_790_series", zpl: "^XA^XZ" });
      expect(capturedContentType).toBe("application/json");
    });

    // PR #74 review round Fix 5: a trailing slash on AGENT_URL (an easy
    // operator typo/copy-paste) used to produce "http://agent.test//print"
    // (getAgentBaseUrl + "/print" by plain string concatenation) -- a
    // DIFFERENT path from the agent's actual "/print" route as far as most
    // HTTP servers/routers are concerned. This MSW server has
    // `onUnhandledRequest: "error"` (startMswServer's default), so a
    // request that actually lands on "//print" instead of "/print" fails
    // this test outright rather than silently mismatching.
    it("hits /print (not //print) when AGENT_URL is configured with a trailing slash", async () => {
      window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test/" };
      await expect(
        agentClient.print({ printer_name: "HP_Smart_Tank_790_series", zpl: "^XA^XZ" }),
      ).resolves.toBeUndefined();
    });

    // Follow-up batch item 2: a wedged agent SendRaw (accepted connection,
    // response never comes) used to leave print() pending FOREVER — and the
    // bulk dialog's dismissal is deliberately locked while printing, so one
    // wedged printer meant an unclosable modal. Same injectable-timeoutMs
    // idiom as checkHealth: the override exists purely so tests exercise the
    // abort path without a real multi-second wait.
    it("rejects with a typed AgentPrintTimeoutError when the agent never responds, without waiting for it", async () => {
      server.use(
        http.post("http://agent.test/print", async () => {
          await delay(300);
          return HttpResponse.json({ status: "printed" });
        }),
      );
      const start = Date.now();
      await expect(
        agentClient.print({ printer_name: "HP_Smart_Tank_790_series", zpl: "^XA^XZ" }, 30),
      ).rejects.toBeInstanceOf(AgentPrintTimeoutError);
      expect(Date.now() - start).toBeLessThan(200);
    });

    it("never masks a genuine network failure as a timeout — a refused connection rejects immediately with a non-timeout error", async () => {
      server.use(http.post("http://agent.test/print", () => HttpResponse.error()));
      let caught: unknown;
      try {
        await agentClient.print({ printer_name: "HP_Smart_Tank_790_series", zpl: "^XA^XZ" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(AgentPrintTimeoutError);
    });
  });

  // P4.3 Task 8 -- the printer wizard's "Enter IP manually" escape hatch
  // (agent/openapi.yaml POST /printers/add, tag "Printers"). Registers a
  // network printer with the agent by IP; the wizard then selects it by
  // the SAME `name` it sent (agentClient.ts's own doc comment on this
  // method -- the 201 response's echoed name/address aren't read).
  describe("addNetworkPrinter", () => {
    it("POSTs {name, ip, port} to /printers/add and resolves void on 201", async () => {
      let captured: unknown;
      server.use(
        http.post("http://agent.test/printers/add", async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ status: "added", name: "Network_Office", address: "192.168.0.245:9100" }, { status: 201 });
        }),
      );
      await expect(
        agentClient.addNetworkPrinter({ name: "Network_Office", ip: "192.168.0.245", port: 9100 }),
      ).resolves.toBeUndefined();
      expect(captured).toEqual({ name: "Network_Office", ip: "192.168.0.245", port: 9100 });
    });

    it("sends Content-Type: application/json (required by the agent's Origin-allowlist auth for mutations)", async () => {
      let capturedContentType: string | null = null;
      server.use(
        http.post("http://agent.test/printers/add", ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json({ status: "added", name: "n", address: "a" }, { status: 201 });
        }),
      );
      await agentClient.addNetworkPrinter({ name: "Network_Office", ip: "192.168.0.245", port: 9100 });
      expect(capturedContentType).toBe("application/json");
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(
        http.post("http://agent.test/printers/add", () => new HttpResponse("name and ip are required", { status: 400 })),
      );
      await expect(
        agentClient.addNetworkPrinter({ name: "", ip: "", port: 9100 }),
      ).rejects.toThrow(/name and ip are required/);
    });
  });

  // P4.3 Task 8 -- the wizard's Save step default-mirror call (spec §5.3
  // "server-wins": the registry's make_default write is the source of
  // truth; this just keeps the agent's OWN /printers/default config in
  // sync for any agent-local caller). Mirrors setDefaultPrinter, tag
  // "Printers".
  describe("setDefaultPrinter", () => {
    it("POSTs {default: name} to /printers/default and resolves void on 200", async () => {
      let captured: unknown;
      server.use(
        http.post("http://agent.test/printers/default", async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ default: "Network_Office" });
        }),
      );
      await expect(agentClient.setDefaultPrinter("Network_Office")).resolves.toBeUndefined();
      expect(captured).toEqual({ default: "Network_Office" });
    });

    it("sends Content-Type: application/json (required by the agent's Origin-allowlist auth for mutations)", async () => {
      let capturedContentType: string | null = null;
      server.use(
        http.post("http://agent.test/printers/default", ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json({ default: "Network_Office" });
        }),
      );
      await agentClient.setDefaultPrinter("Network_Office");
      expect(capturedContentType).toBe("application/json");
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(
        http.post("http://agent.test/printers/default", () => new HttpResponse("printer not in list", { status: 400 })),
      );
      await expect(agentClient.setDefaultPrinter("Missing")).rejects.toThrow(/printer not in list/);
    });
  });

  // P4.1 Task 7 (+ 2026-07-18 atomic-consume migration) -- the handheld-
  // scanner check-in mode's polling primitive. Confirmed present in the
  // agent's OWN contract (agent/openapi.yaml's POST /scan/consume, tag
  // "Scan") -- not a panel-side invention. Replaces the earlier
  // GET /scan/last + POST /scan/clear pair, which had a real race (see
  // docs/superpowers/plans/2026-07-18-agent-atomic-scan-consume.md).
  // Task 5 (P4.3) -- GET /info is the agent's own identity/version endpoint
  // (Task 1, agent/openapi.yaml), unauthenticated. A pre-P4.3 agent binary
  // has no /info route at all and answers 404 -- that 404 is the ONLY case
  // that resolves to null; every other non-2xx is a genuine failure and
  // must throw same as every other agentClient method.
  describe("getInfo", () => {
    it("returns the parsed AgentInfo on 200", async () => {
      await expect(agentClient.getInfo()).resolves.toEqual({
        machine_id: "mach-abc123",
        hostname: "kiosk-07",
        version: "1.4.0",
        uptime_seconds: 3600,
      });
    });

    it("resolves null (not an error) on 404 -- a pre-P4.3 agent with no /info route", async () => {
      server.use(http.get("http://agent.test/info", () => new HttpResponse(null, { status: 404 })));
      await expect(agentClient.getInfo()).resolves.toBeNull();
    });

    it("throws on a non-2xx response, surfacing the agent's plain-text error body", async () => {
      server.use(http.get("http://agent.test/info", () => new HttpResponse("agent misconfigured", { status: 500 })));
      await expect(agentClient.getInfo()).rejects.toThrow(/agent misconfigured/);
    });

    it("throws on a genuine network failure", async () => {
      server.use(http.get("http://agent.test/info", () => HttpResponse.error()));
      await expect(agentClient.getInfo()).rejects.toThrow();
    });
  });

  describe("consumeLastScan", () => {
    it("returns the empty sentinel when nothing has been scanned since the last consume", async () => {
      await expect(agentClient.consumeLastScan()).resolves.toEqual({
        code: "",
        time: "0001-01-01T00:00:00Z",
      });
    });

    it("returns the consumed scan's code and time", async () => {
      server.use(
        http.post("http://agent.test/scan/consume", () =>
          HttpResponse.json({ code: "PD-0107", time: "2026-07-17T10:00:00Z" }),
        ),
      );
      await expect(agentClient.consumeLastScan()).resolves.toEqual({
        code: "PD-0107",
        time: "2026-07-17T10:00:00Z",
      });
    });

    it("sends Content-Type: application/json (required by the agent's Origin-allowlist auth for mutations, even with no body)", async () => {
      let capturedContentType: string | null = null;
      server.use(
        http.post("http://agent.test/scan/consume", ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json({ code: "", time: "0001-01-01T00:00:00Z" });
        }),
      );
      await agentClient.consumeLastScan();
      expect(capturedContentType).toBe("application/json");
    });

    it("throws on a non-2xx response (agent unreachable/error)", async () => {
      server.use(http.post("http://agent.test/scan/consume", () => new HttpResponse(null, { status: 500 })));
      await expect(agentClient.consumeLastScan()).rejects.toThrow();
    });

    it("throws on a genuine network failure", async () => {
      server.use(http.post("http://agent.test/scan/consume", () => HttpResponse.error()));
      await expect(agentClient.consumeLastScan()).rejects.toThrow();
    });
  });
});
