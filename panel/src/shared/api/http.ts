import createClient, { type Middleware } from "openapi-fetch";
import { ApiError } from "./ApiError";
import { getToken } from "./session";
import type { paths } from "./schema";

declare global {
  interface Window {
    __ENV__?: { API_URL?: string };
  }
}

export function getApiBaseUrl(): string {
  return window.__ENV__?.API_URL || import.meta.env.VITE_API_URL || "http://localhost:8008";
}

const auth: Middleware = {
  onRequest({ request }) {
    const token = getToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
};

const errors: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { code?: string; error?: string; message?: string };
      throw new ApiError(response.status, body.code, body.error || body.message || response.statusText);
    }
    return response;
  },
};

export const api = createClient<paths>({
  baseUrl: getApiBaseUrl(),
  // openapi-fetch reads `fetch` once at createClient() time (module load),
  // so it would otherwise close over the real global fetch forever and
  // never see a later `vi.spyOn(globalThis, "fetch")` swap in tests. This
  // thin wrapper re-reads `globalThis.fetch` on every call instead.
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
api.use(auth, errors);
