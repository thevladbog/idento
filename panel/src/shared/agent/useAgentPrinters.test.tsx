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
    requestCounts = { health: 0, printers: 0, default: 0 };
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
});
