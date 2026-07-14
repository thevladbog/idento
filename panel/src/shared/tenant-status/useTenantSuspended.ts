import { useSyncExternalStore } from "react";
import { tenantStatusStore } from "./tenantStatusStore";

export function useTenantSuspended(): boolean {
  return useSyncExternalStore(tenantStatusStore.subscribe, tenantStatusStore.isSuspended);
}
