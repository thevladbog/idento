import type { components } from "../../shared/api/schema";
import { $api } from "../../shared/api/query";
import { getCurrentTenant } from "../../shared/api/session";

type TenantRole = components["schemas"]["TenantMembership"]["role"];

export function useActiveTenantRole(): TenantRole | undefined {
  const activeTenant = getCurrentTenant();
  const tenantQuery = $api.useQuery(
    "get",
    "/api/tenants/{id}",
    { params: { path: { id: activeTenant?.id ?? "" } } },
    { enabled: activeTenant !== null },
  );

  return tenantQuery.data?.role;
}
