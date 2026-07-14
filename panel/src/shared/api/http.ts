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

// openapi-fetch resolves the client's `baseUrl` once, at createClient() time
// (module load), and bakes it into the initial `Request` object it builds
// before any middleware runs. That means the `baseUrl` passed below would
// otherwise go stale forever for anything that doesn't pass a per-call
// `baseUrl` override (e.g. `$api`'s generated `useQuery`/`useMutation`
// hooks in ./query.ts, which have no such override). This middleware
// re-reads `getApiBaseUrl()` on every request and rewrites the outgoing
// Request's origin to match, the same "read fresh each request" principle
// as the dynamic-`fetch` wrapper below, just applied to the URL. It must
// run first so downstream middleware (auth, errors) see the corrected URL.
//
// Note: `new Request(url, request)` (passing the original Request as
// `init`) looks like the idiomatic clone-with-overrides pattern and works
// under Node's native Request, but jsdom's Request implementation (used by
// this project's Vitest environment) silently drops `method`/`body` when a
// Request instance is passed as `init` instead of a plain RequestInit. So
// each field is copied explicitly instead, with the body read via
// `clone().arrayBuffer()` to avoid a ReadableStream `duplex` requirement.
//
// Also note: `url.host = target.host` does NOT clear a pre-existing port
// when `target.host` has none (e.g. rewriting "localhost:8008" to
// "api.test" leaves "api.test:8008" — the old port survives). Setting
// `hostname` and `port` separately avoids that.
const dynamicBaseUrl: Middleware = {
  async onRequest({ request }) {
    const target = new URL(getApiBaseUrl());
    const url = new URL(request.url);
    url.protocol = target.protocol;
    url.hostname = target.hostname;
    url.port = target.port;
    const body = request.body ? await request.clone().arrayBuffer() : undefined;
    return new Request(url, {
      method: request.method,
      headers: request.headers,
      body,
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
      signal: request.signal,
      mode: request.mode,
    });
  },
};

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
api.use(dynamicBaseUrl, auth, errors);
