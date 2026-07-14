import { ApiError } from "./ApiError";
import { getToken } from "./session";
import type { AuthResponse, InstanceInfo, QrLoginResponse, SwitchTenantResponse } from "./types";

declare global {
  interface Window {
    __ENV__?: { API_URL?: string };
  }
}

export function getApiBaseUrl(): string {
  return window.__ENV__?.API_URL || import.meta.env.VITE_API_URL || "http://localhost:8008";
}

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string; message?: string };
  if (!res.ok) {
    throw new ApiError(res.status, body.code, body.error || body.message || res.statusText);
  }
  return body;
}

async function publicFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return parseJsonOrThrow(res);
}

async function authFetch(path: string, init?: RequestInit): Promise<unknown> {
  const token = getToken();
  return publicFetch(path, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return publicFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }) as Promise<AuthResponse>;
}

export async function register(tenantName: string, email: string, password: string): Promise<AuthResponse> {
  return publicFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ tenant_name: tenantName, email, password }),
  }) as Promise<AuthResponse>;
}

export async function loginWithQr(qrToken: string): Promise<QrLoginResponse> {
  return publicFetch("/auth/login-qr", {
    method: "POST",
    body: JSON.stringify({ qr_token: qrToken }),
  }) as Promise<QrLoginResponse>;
}

export async function getInstance(): Promise<InstanceInfo> {
  return publicFetch("/api/instance") as Promise<InstanceInfo>;
}

export async function switchTenant(tenantId: string): Promise<SwitchTenantResponse> {
  return authFetch("/api/auth/switch-tenant", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId }),
  }) as Promise<SwitchTenantResponse>;
}
