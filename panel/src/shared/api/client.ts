import { api, getApiBaseUrl } from "./http";
import type { AuthResponse, InstanceInfo, QrLoginResponse, SwitchTenantResponse } from "./types";

export { getApiBaseUrl } from "./http";

function required<T>(data: T | undefined): T {
  if (data === undefined) {
    throw new Error("Empty response body");
  }
  return data;
}

// `api` resolves its `baseUrl` once, at module-load time (openapi-fetch has
// no notion of a dynamic base URL). Passing `baseUrl` again per-call — which
// openapi-fetch does support as a per-request override — re-resolves it
// against the current `window.__ENV__`/`VITE_API_URL` on every request, same
// as the old hand-written `publicFetch`/`authFetch` did.
export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.POST("/auth/login", { baseUrl: getApiBaseUrl(), body: { email, password } });
  return required(data);
}

export async function register(tenantName: string, email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.POST("/auth/register", {
    baseUrl: getApiBaseUrl(),
    body: { tenant_name: tenantName, email, password },
  });
  return required(data);
}

export async function loginWithQr(qrToken: string): Promise<QrLoginResponse> {
  const { data } = await api.POST("/auth/login-qr", { baseUrl: getApiBaseUrl(), body: { qr_token: qrToken } });
  return required(data);
}

export async function getInstance(): Promise<InstanceInfo> {
  const { data } = await api.GET("/api/instance", { baseUrl: getApiBaseUrl() });
  return required(data);
}

export async function switchTenant(tenantId: string): Promise<SwitchTenantResponse> {
  const { data } = await api.POST("/api/auth/switch-tenant", {
    baseUrl: getApiBaseUrl(),
    body: { tenant_id: tenantId },
  });
  return required(data);
}
