import { useQueryClient } from "@tanstack/react-query";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
// P4.3 Task 10: useEquipmentMachine/EQUIPMENT_MACHINE_KEY/isEmptyRegistry
// moved to shared/agent/useEquipmentMachine.ts so useAgentPrinters (shared/
// agent) can consume the machine registry query without a shared/ ->
// features/ import (layering) -- imported (for EQUIPMENT_MACHINE_KEY's own
// use below in every mutation's invalidateQueries) and re-exported here so
// every existing import in this feature (EquipmentPage.tsx,
// PrinterWizard.tsx, ScannerWizard.tsx, hooks.test.tsx) keeps compiling
// unchanged.
import { EQUIPMENT_MACHINE_KEY, isEmptyRegistry, useEquipmentMachine } from "../../shared/agent/useEquipmentMachine";
export { EQUIPMENT_MACHINE_KEY, isEmptyRegistry, useEquipmentMachine };

// PR #83 bot-review round 1, Finding 4 -- panel/AGENTS.md's "Readiness
// invalidation" rule: any mutation that changes content a workspace
// readiness step gates on must also invalidate READINESS_KEY(eventId)
// (events/hooks.ts) alongside its own resource key. Equipment is an
// ORG-level resource (no eventId anywhere in this file), but the backend's
// EQUIPMENT readiness step (device presence / a tested default printer)
// reads off this SAME registry for every event under the tenant -- so a
// device create/delete/default-repoint/test-pass must invalidate every
// event's readiness query, not one this file can't even name.
// READINESS_KEY(eventId) itself needs a concrete eventId; instead this uses
// the [method, path-template] PREFIX idiom ATTENDEES_LIST_KEY documents
// (attendees/hooks.ts): a queryKey of just [method, path] -- no third
// `init` element -- partial-matches every registered readiness query
// regardless of which event populated it (TanStack's partialMatchKey only
// walks keys PRESENT in the filter key). Verified against READINESS_KEY's
// own real shape (events/hooks.ts:33-35). Covered by the "readiness
// invalidation" describe block in hooks.test.tsx.
const ALL_EVENTS_READINESS_KEY = ["get", "/api/events/{id}/readiness"] as const;

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
// ownership check), not tied to any one event. useEquipmentMachine/
// EQUIPMENT_MACHINE_KEY/isEmptyRegistry themselves now live in
// shared/agent/useEquipmentMachine.ts (re-exported above) — the mutations
// below still import EQUIPMENT_MACHINE_KEY from this file's own re-export
// so their invalidation calls need no import changes.
// ---------------------------------------------------------------------------

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
      // Finding 4 -- a new device can flip the EQUIPMENT readiness step for
      // every event under this tenant.
      void queryClient.invalidateQueries({ queryKey: ALL_EVENTS_READINESS_KEY });
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
      // Finding 4 -- removing a device (e.g. the tested default printer)
      // can flip the EQUIPMENT readiness step for every event under this
      // tenant.
      void queryClient.invalidateQueries({ queryKey: ALL_EVENTS_READINESS_KEY });
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
      // Finding 4 -- repointing (or clearing) the default printer can flip
      // the EQUIPMENT readiness step for every event under this tenant.
      void queryClient.invalidateQueries({ queryKey: ALL_EVENTS_READINESS_KEY });
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
      // Finding 4 -- a passed test on the default printer is exactly what
      // TenantHasTestedDefaultPrinter (the backend's readiness check) reads
      // for every event under this tenant.
      void queryClient.invalidateQueries({ queryKey: ALL_EVENTS_READINESS_KEY });
    },
  });
}
