import { $api } from "../api/query";
import { ApiError } from "../api/ApiError";

// P4.3 Task 10: moved here from features/equipment/hooks.ts (which
// re-exports all three for Task 6-9's existing imports) so useAgentPrinters
// (this directory) can consume the machine registry query without a
// shared/ -> features/ import -- shared/agent must not depend on
// features/equipment; the machine registry query is the shared primitive,
// the hub/wizard UI built on top of it is the feature.

// `machineId` is nullable because a caller (the hub, or useAgentPrinters
// below) doesn't know its own machine_id until the agent's GET /info
// resolves (useAgentInfo) -- this query stays disabled (never fetches)
// until that identity is known, same "enabled on a not-yet-known id" idiom
// as OrganizationPage.tsx's `$api.useQuery("get", "/api/tenants/{id}", {
// params: { path: { id: tenant?.id ?? "" } } }, { enabled: tenant !== null
// })`. A 404 here is NOT an application error -- it means this (tenant,
// machine_id) has simply never been registered -- see isEmptyRegistry
// below, which callers use to render the "empty registry" state instead of
// a generic error banner.
export function useEquipmentMachine(machineId: string | null) {
  return $api.useQuery(
    "get",
    "/api/equipment/machines/{machine_id}",
    { params: { path: { machine_id: machineId ?? "" } } },
    // PR #83 bot-review round 1, Finding 9: same house convention as
    // useAgentInfo.ts/useAgentPrinters.ts's own `retry: false` -- a 404
    // here is the documented-normal "never registered" case (isEmptyRegistry
    // above), not a transient fault, so TanStack's default 3 retries would
    // only delay the first reconcile on a fresh machine for no benefit.
    { enabled: machineId != null, retry: false },
  );
}

// Query-key for GET /api/equipment/machines/{machine_id}, matching
// useEquipmentMachine's exact params shape. Same verified [method, path,
// init] shape MONITOR_SNAPSHOT_KEY documents (monitor/hooks.ts) -- every
// mutation in features/equipment/hooks.ts invalidates this to keep a
// mounted hub in sync.
export function EQUIPMENT_MACHINE_KEY(machineId: string) {
  return ["get", "/api/equipment/machines/{machine_id}", { params: { path: { machine_id: machineId } } }] as const;
}

// True exactly when `error` is the "(tenant_id, machine_id) has never been
// registered" 404 from GET /api/equipment/machines/{machine_id}
// (schema.d.ts's getEquipmentMachine 404 doc comment) -- every non-2xx
// response from `$api` throws an ApiError (shared/api/http.ts's `errors`
// middleware), so this is a plain status check, same idiom as
// OrganizationPage.tsx's `updateTenant.error instanceof ApiError &&
// updateTenant.error.status === 403`.
export function isEmptyRegistry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
