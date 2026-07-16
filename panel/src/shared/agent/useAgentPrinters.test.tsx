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
let requestCounts = { health: 0, printers: 0, default: 0 };

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
);
// startMswServer's return value only matters for its listen/reset/close
// lifecycle side effects (registered via beforeAll/afterEach/afterAll) —
// this file never needs server.use() for per-test overrides, unlike
// agentClient.test.ts.
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
    requestCounts = { health: 0, printers: 0, default: 0 };
  });

  it("is disconnected and fetches nothing while disabled", () => {
    const { result } = renderHook(() => useAgentPrinters(false), { wrapper });
    expect(result.current).toEqual({ state: "disconnected", printers: [], defaultPrinter: null });
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
});
