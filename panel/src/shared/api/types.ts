export interface User {
  id: string;
  tenant_id: string;
  email: string;
  role: "admin" | "manager" | "staff";
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  tenants: Tenant[];
  current_tenant?: Tenant;
}

export interface QrLoginResponse {
  token: string;
  user: User;
}

export interface InstanceInfo {
  mode: "saas" | "onprem";
  version: string;
  license: unknown;
}

export interface SwitchTenantResponse {
  token: string;
  current_tenant: Tenant;
}
