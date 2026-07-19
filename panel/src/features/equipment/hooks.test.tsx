// P4.3 Task 6 -- MSW harness for the equipment registry hooks, copied from
// features/monitor/hooks.test.tsx's structure (startMswServer + a
// per-test-fresh QueryClient wrapper via makeWrapper()).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { useEventReadiness } from "../events/hooks";
import {
  EQUIPMENT_MACHINE_KEY,
  isEmptyRegistry,
  useCreateDevice,
  useDeleteDevice,
  useEquipmentMachine,
  useMarkTestPassed,
  usePatchDevice,
  useSetDefaultPrinter,
  useUpsertMachine,
} from "./hooks";

let machineGetCount = 0;
let machineGetStatus = 200;
let capturedMachineId: string | undefined;
// PR #83 bot-review round 1, Finding 4 -- a genuinely subscribed
// GET /api/events/:id/readiness observer, same ReadinessObserver discipline
// as AddAttendeeDialog.test.tsx/events/hooks.test.tsx: proves an
// invalidateQueries call produces an OBSERVABLE refetch, not just that the
// call was made.
let readinessGetCount = 0;

function machineResponse() {
  return {
    machine: {
      machine_id: "mach-1",
      hostname: "kiosk-07",
      agent_version: "1.4.0",
      last_seen_at: "2026-07-19T00:00:00Z",
      created_at: "2026-07-01T00:00:00Z",
    },
    devices: [
      {
        id: "dev-1",
        class: "printer",
        kind: "system",
        display_name: "Front Desk Printer",
        config: { agent_name: "HP_Smart_Tank_790" },
        is_default: true,
        test_passed_at: null,
        last_seen_at: null,
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ],
  };
}

const server = startMswServer(
  http.get("http://api.test/api/equipment/machines/:machineId", ({ params }) => {
    machineGetCount += 1;
    capturedMachineId = params.machineId as string;
    if (machineGetStatus !== 200) {
      return HttpResponse.json({ error: "machine error" }, { status: machineGetStatus });
    }
    return HttpResponse.json(machineResponse());
  }),
  http.put("http://api.test/api/equipment/machines/:machineId", () => HttpResponse.json(machineResponse())),
  http.post("http://api.test/api/equipment/machines/:machineId/devices", () =>
    HttpResponse.json(machineResponse().devices[0], { status: 201 }),
  ),
  http.patch("http://api.test/api/equipment/devices/:deviceId", () =>
    HttpResponse.json(machineResponse().devices[0]),
  ),
  http.delete("http://api.test/api/equipment/devices/:deviceId", () => new HttpResponse(null, { status: 204 })),
  http.put("http://api.test/api/equipment/machines/:machineId/default-printer", async ({ request }) => {
    const body = (await request.json()) as { device_id: string | null };
    return HttpResponse.json(body);
  }),
  http.post("http://api.test/api/equipment/devices/:deviceId/test-passed", () => new HttpResponse(null, { status: 204 })),
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessGetCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
);
void server;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

describe("equipment hooks", () => {
  beforeEach(() => {
    machineGetCount = 0;
    machineGetStatus = 200;
    capturedMachineId = undefined;
    readinessGetCount = 0;
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  describe("useEquipmentMachine", () => {
    it("requests the machine + devices by id", async () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(capturedMachineId).toBe("mach-1");
      expect(result.current.data?.machine.hostname).toBe("kiosk-07");
      expect(result.current.data?.devices).toHaveLength(1);
    });

    it("is disabled (never fetches) when machineId is null", async () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useEquipmentMachine(null), { wrapper: Wrapper });

      // Give it a beat to (not) fire a request.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(machineGetCount).toBe(0);
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("surfaces a 404 (unregistered machine) as an error isEmptyRegistry recognizes", async () => {
      machineGetStatus = 404;
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useEquipmentMachine("mach-unknown"), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(isEmptyRegistry(result.current.error)).toBe(true);
    });

    // PR #83 bot-review round 1, Finding 9: the query had no `retry`
    // override of its own, so a fresh (never-registered) machine's
    // documented-normal 404 got TanStack's default 3 retries -- delaying
    // the first reconcile. useAgentInfo/useAgentPrinters both already set
    // `retry: false` for exactly this reason (agentClient's own health/info
    // 404s are documented normal states, not transient faults) -- this pins
    // the same convention here. Deliberately builds its OWN QueryClient
    // (not makeWrapper's, which sets `retry: false` at the CLIENT level for
    // every test in this file) so the assertion actually exercises the
    // HOOK's own retry setting rather than being masked by the harness
    // default; `retryDelay: 0` only removes the exponential backoff wait,
    // it does not change the retry COUNT that's under test.
    it("does not retry the machine 404 -- exactly one request, matching the useAgentInfo/useAgentPrinters retry:false convention", async () => {
      machineGetStatus = 404;
      const qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      // A beat for any retry TanStack's default would otherwise still be
      // mid-flight on (retryDelay: 0 makes those fire almost immediately,
      // not instantly).
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(machineGetCount).toBe(1);
    });
  });

  describe("isEmptyRegistry", () => {
    it("is false for a non-404 ApiError", async () => {
      machineGetStatus = 500;
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(isEmptyRegistry(result.current.error)).toBe(false);
    });

    it("is false for a plain Error and for non-error values", () => {
      expect(isEmptyRegistry(new Error("boom"))).toBe(false);
      expect(isEmptyRegistry(null)).toBe(false);
      expect(isEmptyRegistry(undefined)).toBe(false);
      expect(isEmptyRegistry("404")).toBe(false);
    });
  });

  // Query-key parity, same as MONITOR_SNAPSHOT_KEY's describe block
  // (monitor/hooks.test.tsx): the key must match useEquipmentMachine's real
  // registered query key so invalidateQueries (every mutation below) refetches.
  describe("EQUIPMENT_MACHINE_KEY", () => {
    it("matches useEquipmentMachine's query for the same machine", async () => {
      const { qc, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      await qc.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY("mach-1") });

      await waitFor(() => expect(machineGetCount).toBe(2));
    });

    it("does not match a different machine's query", async () => {
      const { qc, Wrapper } = makeWrapper();
      const { result: m1 } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      const { result: m2 } = renderHook(() => useEquipmentMachine("mach-2"), { wrapper: Wrapper });
      await waitFor(() => expect(m1.current.isSuccess).toBe(true));
      await waitFor(() => expect(m2.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(2);

      await qc.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY("mach-1") });

      await waitFor(() => expect(machineGetCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(machineGetCount).toBe(3);
    });
  });

  describe("useUpsertMachine", () => {
    it("PUTs the machine upsert and invalidates that machine's query on success", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      const { result: upsertResult } = renderHook(() => useUpsertMachine(), { wrapper: Wrapper });
      upsertResult.current.mutate({
        params: { path: { machine_id: "mach-1" } },
        body: { hostname: "kiosk-07", agent_version: "1.4.1", seen_device_ids: ["dev-1"] },
      });
      await waitFor(() => expect(upsertResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(machineGetCount).toBe(2));
    });
  });

  describe("useCreateDevice", () => {
    it("POSTs a new device under the machine and invalidates the machine query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      const { result: createResult } = renderHook(() => useCreateDevice("mach-1"), { wrapper: Wrapper });
      createResult.current.mutate({
        params: { path: { machine_id: "mach-1" } },
        body: {
          class: "printer",
          kind: "system",
          display_name: "Front Desk Printer",
          config: { agent_name: "HP_Smart_Tank_790" },
        },
      });
      await waitFor(() => expect(createResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(machineGetCount).toBe(2));
    });
  });

  describe("usePatchDevice", () => {
    it("PATCHes a device and invalidates its machine's query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      const { result: patchResult } = renderHook(() => usePatchDevice("mach-1"), { wrapper: Wrapper });
      patchResult.current.mutate({
        params: { path: { device_id: "dev-1" } },
        body: { display_name: "Lobby Printer" },
      });
      await waitFor(() => expect(patchResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(machineGetCount).toBe(2));
    });
  });

  describe("useDeleteDevice", () => {
    it("DELETEs a device and invalidates its machine's query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      const { result: deleteResult } = renderHook(() => useDeleteDevice("mach-1"), { wrapper: Wrapper });
      deleteResult.current.mutate({ params: { path: { device_id: "dev-1" } } });
      await waitFor(() => expect(deleteResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(machineGetCount).toBe(2));
    });
  });

  describe("useSetDefaultPrinter", () => {
    it("PUTs the machine's default printer and invalidates its machine's query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      const { result: defaultResult } = renderHook(() => useSetDefaultPrinter("mach-1"), { wrapper: Wrapper });
      defaultResult.current.mutate({
        params: { path: { machine_id: "mach-1" } },
        body: { device_id: "dev-1" },
      });
      await waitFor(() => expect(defaultResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(machineGetCount).toBe(2));
    });
  });

  describe("useMarkTestPassed", () => {
    it("POSTs test-passed for a device and invalidates its machine's query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: listResult } = renderHook(() => useEquipmentMachine("mach-1"), { wrapper: Wrapper });
      await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
      expect(machineGetCount).toBe(1);

      const { result: testResult } = renderHook(() => useMarkTestPassed("mach-1"), { wrapper: Wrapper });
      testResult.current.mutate({ params: { path: { device_id: "dev-1" } } });
      await waitFor(() => expect(testResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(machineGetCount).toBe(2));
    });
  });

  // PR #83 bot-review round 1, Finding 4: equipment is an ORG-level
  // resource (no eventId anywhere in this file), but four of its mutations
  // change content the workspace rail's EQUIPMENT readiness step gates on
  // (device presence / a tested default printer) for EVERY event under
  // this tenant -- panel/AGENTS.md's "readiness invalidation" rule.
  // READINESS_KEY(eventId) itself needs a concrete eventId this file
  // doesn't have, so the fix uses the [method, path-template] PREFIX
  // idiom ATTENDEES_LIST_KEY documents (attendees/hooks.ts): a queryKey of
  // just [method, path], no third `init` element, partial-matches every
  // registered readiness query regardless of which event populated it.
  // Proven here against TWO different events' readiness observers sharing
  // one QueryClient -- a genuine prefix match refetches BOTH, which a
  // (nonexistent, since there's no eventId) scoped call could never do.
  // patchDevice (rename) and upsertMachine are deliberately NOT covered
  // here -- neither changes anything the readiness step reads.
  describe("readiness invalidation (org-level prefix -- create/delete/set-default/mark-test-passed)", () => {
    it("useCreateDevice invalidates every event's readiness query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: evt1 } = renderHook(() => useEventReadiness("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useEventReadiness("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(readinessGetCount).toBe(2);

      const { result: createResult } = renderHook(() => useCreateDevice("mach-1"), { wrapper: Wrapper });
      createResult.current.mutate({
        params: { path: { machine_id: "mach-1" } },
        body: { class: "printer", kind: "system", display_name: "Front Desk Printer", config: {} },
      });
      await waitFor(() => expect(createResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(readinessGetCount).toBe(4));
    });

    it("useDeleteDevice invalidates every event's readiness query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: evt1 } = renderHook(() => useEventReadiness("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useEventReadiness("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(readinessGetCount).toBe(2);

      const { result: deleteResult } = renderHook(() => useDeleteDevice("mach-1"), { wrapper: Wrapper });
      deleteResult.current.mutate({ params: { path: { device_id: "dev-1" } } });
      await waitFor(() => expect(deleteResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(readinessGetCount).toBe(4));
    });

    it("useSetDefaultPrinter invalidates every event's readiness query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: evt1 } = renderHook(() => useEventReadiness("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useEventReadiness("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(readinessGetCount).toBe(2);

      const { result: defaultResult } = renderHook(() => useSetDefaultPrinter("mach-1"), { wrapper: Wrapper });
      defaultResult.current.mutate({ params: { path: { machine_id: "mach-1" } }, body: { device_id: "dev-1" } });
      await waitFor(() => expect(defaultResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(readinessGetCount).toBe(4));
    });

    it("useMarkTestPassed invalidates every event's readiness query", async () => {
      const { Wrapper } = makeWrapper();
      const { result: evt1 } = renderHook(() => useEventReadiness("evt-1"), { wrapper: Wrapper });
      const { result: evt2 } = renderHook(() => useEventReadiness("evt-2"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      await waitFor(() => expect(evt2.current.isSuccess).toBe(true));
      expect(readinessGetCount).toBe(2);

      const { result: testResult } = renderHook(() => useMarkTestPassed("mach-1"), { wrapper: Wrapper });
      testResult.current.mutate({ params: { path: { device_id: "dev-1" } } });
      await waitFor(() => expect(testResult.current.isSuccess).toBe(true));

      await waitFor(() => expect(readinessGetCount).toBe(4));
    });

    it("usePatchDevice (rename) does NOT invalidate readiness -- renaming a device doesn't change the readiness step", async () => {
      const { Wrapper } = makeWrapper();
      const { result: evt1 } = renderHook(() => useEventReadiness("evt-1"), { wrapper: Wrapper });
      await waitFor(() => expect(evt1.current.isSuccess).toBe(true));
      expect(readinessGetCount).toBe(1);

      const { result: patchResult } = renderHook(() => usePatchDevice("mach-1"), { wrapper: Wrapper });
      patchResult.current.mutate({ params: { path: { device_id: "dev-1" } }, body: { display_name: "Renamed" } });
      await waitFor(() => expect(patchResult.current.isSuccess).toBe(true));

      // A beat to (not) see a refetch it has no business causing.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(readinessGetCount).toBe(1);
    });
  });
});
