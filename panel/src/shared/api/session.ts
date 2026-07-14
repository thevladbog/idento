import type { AuthResponse, Tenant, User } from "./types";

const TOKEN_KEY = "token";
const USER_KEY = "user";
const TENANTS_KEY = "tenants";
const CURRENT_TENANT_KEY = "current_tenant";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function hasSession(): boolean {
  return getToken() !== null;
}

export function saveSession(auth: AuthResponse): void {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
  localStorage.setItem(TENANTS_KEY, JSON.stringify(auth.tenants));
  const current = auth.current_tenant ?? auth.tenants[0];
  if (current) localStorage.setItem(CURRENT_TENANT_KEY, JSON.stringify(current));
}

export function updateToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function updateCurrentTenant(tenant: Tenant): void {
  localStorage.setItem(CURRENT_TENANT_KEY, JSON.stringify(tenant));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TENANTS_KEY);
  localStorage.removeItem(CURRENT_TENANT_KEY);
}

export function getCurrentUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function getTenants(): Tenant[] {
  const raw = localStorage.getItem(TENANTS_KEY);
  return raw ? (JSON.parse(raw) as Tenant[]) : [];
}

export function getCurrentTenant(): Tenant | null {
  const raw = localStorage.getItem(CURRENT_TENANT_KEY);
  return raw ? (JSON.parse(raw) as Tenant) : null;
}
