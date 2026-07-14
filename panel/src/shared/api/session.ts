import type { AuthResponse, Tenant, User } from "./types";

const TOKEN_KEY = "token";
const USER_KEY = "user";
const TENANTS_KEY = "tenants";
const CURRENT_TENANT_KEY = "current_tenant";

// Local copies of the impersonation feature's raw key names (not imported —
// shared/ must not depend on features/, see panel/AGENTS.md). Kept in sync
// with the constants of the same name in
// src/features/impersonation/impersonationSession.ts.
const IMPERSONATION_SESSION_KEY = "impersonation";
const IMPERSONATION_OPERATOR_TOKEN_KEY = "operator_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function hasSession(): boolean {
  return getToken() !== null;
}

export function saveSession(auth: AuthResponse): void {
  // A fresh login must not leave a stale parked impersonation session
  // behind — otherwise the banner would keep showing and "End session"
  // would restore the old operator token over this user's new session.
  localStorage.removeItem(IMPERSONATION_SESSION_KEY);
  localStorage.removeItem(IMPERSONATION_OPERATOR_TOKEN_KEY);
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
  localStorage.setItem(TENANTS_KEY, JSON.stringify(auth.tenants));
  const current = auth.current_tenant ?? auth.tenants[0];
  if (current) {
    localStorage.setItem(CURRENT_TENANT_KEY, JSON.stringify(current));
  } else {
    localStorage.removeItem(CURRENT_TENANT_KEY);
  }
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
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function getTenants(): Tenant[] {
  const raw = localStorage.getItem(TENANTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Tenant[];
  } catch {
    localStorage.removeItem(TENANTS_KEY);
    return [];
  }
}

export function getCurrentTenant(): Tenant | null {
  const raw = localStorage.getItem(CURRENT_TENANT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tenant;
  } catch {
    localStorage.removeItem(CURRENT_TENANT_KEY);
    return null;
  }
}
