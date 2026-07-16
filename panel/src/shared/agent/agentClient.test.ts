import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { agentClient } from "./agentClient";
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
  });
});
