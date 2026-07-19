import { useQueryClient } from "@tanstack/react-query";
import { $api } from "../../shared/api/query";
import { ApiError } from "../../shared/api/ApiError";
import type { components } from "../../shared/api/schema";

// Re-exported schema types for Task 7+ consumers (mirrors checkin/hooks.ts's
// CheckinStation/staff/hooks.ts's StaffUser precedent) — keeps the generated
// schema index paths out of every downstream file that just needs the shape.
// reconcile.ts imports EquipmentDevice from HERE (not straight off `schema`)
// for the same reason.
export type EquipmentMachine = components["schemas"]["EquipmentMachine"];
export type EquipmentDevice = components["schemas"]["EquipmentDevice"];
export type EquipmentMachineResponse = components["schemas"]["EquipmentMachineResponse"];

// ---------------------------------------------------------------------------
// Machine registry root — GET/PUT /api/equipment/machines/{machine_id}
// (P4.3 spec §4.1). An ORG-level resource (tenant_id from the JWT is the
// ownership check), not tied to any one event.
// ---------------------------------------------------------------------------

// `machineId` is nullable because the hub (Task 7) doesn't know its own
// machine_id until the agent's GET /info resolves (useAgentInfo) — this
// query stays disabled (never fetches) until that identity is known, same
// "enabled on a not-yet-known id" idiom as OrganizationPage.tsx's
// `$api.useQuery("get", "/api/tenants/{id}", { params: { path: { id:
// tenant?.id ?? "" } } }, { enabled: tenant !== null })`. A 404 here is NOT
// an application error — it means this (tenant, machine_id) has simply
// never been registered — see isEmptyRegistry below, which callers use to
// render the "empty registry" state instead of a generic error banner.
export function useEquipmentMachine(machineId: string | null) {
  return $api.useQuery(
    "get",
    "/api/equipment/machines/{machine_id}",
    { params: { path: { machine_id: machineId ?? "" } } },
    { enabled: machineId != null },
  );
}

// Query-key for GET /api/equipment/machines/{machine_id}, matching
// useEquipmentMachine's exact params shape. Same verified [method, path,
// init] shape MONITOR_SNAPSHOT_KEY documents (monitor/hooks.ts) — every
// mutation below invalidates this to keep a mounted hub in sync.
export function EQUIPMENT_MACHINE_KEY(machineId: string) {
  return ["get", "/api/equipment/machines/{machine_id}", { params: { path: { machine_id: machineId } } }] as const;
}

// True exactly when `error` is the "(tenant_id, machine_id) has never been
// registered" 404 from GET /api/equipment/machines/{machine_id}
// (schema.d.ts's getEquipmentMachine 404 doc comment) — every non-2xx
// response from `$api` throws an ApiError (shared/api/http.ts's `errors`
// middleware), so this is a plain status check, same idiom as
// OrganizationPage.tsx's `updateTenant.error instanceof ApiError &&
// updateTenant.error.status === 403`.
export function isEmptyRegistry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// Register/refresh a machine (spec §4.1) — idempotent upsert, called once
// per hub visit with the agent's self-reported hostname/agent_version and
// (Task 7's reconcile pass) `seen_device_ids`. Deliberately takes NO
// `machineId` argument of its own — same "derive from the SETTLING
// mutate() call's variables, not a render-time closure" rationale as
// badge/useSaveTemplate.ts (see that file's own extensive comment): the
// hub could in principle re-mount against a different machine_id between
// this mutate() call and its response settling, and cache correctness must
// follow the machine that call actually targeted. The PUT response is this
// query's exact shape (EquipmentMachineResponse), so it's seeded directly
// (avoiding a stale flash) in addition to being invalidated.
export function useUpsertMachine() {
  const queryClient = useQueryClient();
  return $api.useMutation("put", "/api/equipment/machines/{machine_id}", {
    onSuccess: (data, variables) => {
      const machineId = variables.params.path.machine_id;
      queryClient.setQueryData(EQUIPMENT_MACHINE_KEY(machineId), data);
      void queryClient.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY(machineId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Device mutations. Unlike useUpsertMachine, these DO take `machineId` as a
// hook-level argument — POST devices is scoped by machine_id in its own
// path, but PATCH/DELETE device and POST test-passed are scoped by
// device_id alone (schema.d.ts has no machine_id in those paths at all), so
// there is no `variables.params.path.machine_id` to derive from for THOSE.
// Every hub screen (Task 7) is mounted against exactly one machine for its
// whole lifetime, so this closure doesn't carry the stale-navigation hazard
// useSaveTemplate's comment warns about — same reasoning as
// checkin/hooks.ts's useSaveCheckinSettings taking `eventId` directly.
// ---------------------------------------------------------------------------

// Register a new device under the machine (spec §4.1's class/kind/config
// validation rules — enforced server-side, not duplicated here).
export function useCreateDevice(machineId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/equipment/machines/{machine_id}/devices", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY(machineId) });
    },
  });
}

// Rename a device and/or replace its config (spec §4.1). class/kind/
// machine_id are immutable and not settable here.
export function usePatchDevice(machineId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("patch", "/api/equipment/devices/{device_id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY(machineId) });
    },
  });
}

// Remove a device outright (spec §4.1) — no special-case handling for "was
// this the default printer"; it is simply gone.
export function useDeleteDevice(machineId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("delete", "/api/equipment/devices/{device_id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY(machineId) });
    },
  });
}

// Repoint (or clear, device_id=null) the machine's default printer
// (spec §4.1).
export function useSetDefaultPrinter(machineId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("put", "/api/equipment/machines/{machine_id}/default-printer", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY(machineId) });
    },
  });
}

// Stamp test_passed_at = now() on a successful test-print/test-scan (the
// wizard's Test step, Tasks 8/9) — feeds TenantHasTestedDefaultPrinter, the
// equipment-readiness gate's underlying query (Task 4).
export function useMarkTestPassed(machineId: string) {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/equipment/devices/{device_id}/test-passed", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EQUIPMENT_MACHINE_KEY(machineId) });
    },
  });
}
