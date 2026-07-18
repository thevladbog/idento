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
  http.post("http://agent.test/print", () => HttpResponse.json({ status: "printed" })),
  http.post("http://agent.test/scan/consume", () =>
    HttpResponse.json({ code: "", time: "0001-01-01T00:00:00Z" }),
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

  // P4.1 Task 7 (+ 2026-07-18 atomic-consume migration) -- the handheld-
  // scanner check-in mode's polling primitive. Confirmed present in the
  // agent's OWN contract (agent/openapi.yaml's POST /scan/consume, tag
  // "Scan") -- not a panel-side invention. Replaces the earlier
  // GET /scan/last + POST /scan/clear pair, which had a real race (see
  // docs/superpowers/plans/2026-07-18-agent-atomic-scan-consume.md).
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
