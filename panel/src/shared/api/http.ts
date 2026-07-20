import createClient, { type Middleware } from "openapi-fetch";
import { ApiError } from "./ApiError";
import { getToken } from "./session";
import type { paths } from "./schema";

declare global {
  interface Window {
    // AGENT_DOWNLOAD_URL (P4.3 Task 7, board 5d): the "Start the agent"
    // card's download-link href — read fresh at render time, same
    // window.__ENV__ runtime-config mechanism as API_URL/AGENT_URL above,
    // so an on-prem operator can point it at their own mirror.
    __ENV__?: { API_URL?: string; AGENT_URL?: string; AGENT_DOWNLOAD_URL?: string };
  }
}

// PR #81 bot round Finding C2: mirrors getAgentBaseUrl's trailing-slash
// strip below -- a configured API_URL with a trailing slash (an operator
// typo, or a value copy-pasted straight from a browser address bar) is
// otherwise safe for every consumer THROUGH this file (openapi-fetch's own
// `baseUrl` handling already tolerates it, and `dynamicBaseUrl` below only
// ever copies protocol/hostname/port off this value, never the pathname),
// but useMonitorStream.ts's SSE client bypasses `api`/openapi-fetch
// entirely (raw `fetch` + string concatenation, the exact bug class Fix 5
// fixed for AGENT_URL) and would otherwise build "http://api.test//api/...".
// Normalizing once, here, covers that caller without it needing to know.
export function getApiBaseUrl(): string {
  const configured = window.__ENV__?.API_URL || import.meta.env.VITE_API_URL || "http://localhost:8008";
  return configured.replace(/\/+$/, "");
}

// The local print agent is a separate origin from the backend API — it's not
// in backend/openapi.yaml and isn't fronted by `$api` (see
// panel/src/shared/agent/agentClient.ts). Mirrors getApiBaseUrl's precedence
// (window.__ENV__ override, else the dev-machine default), but has no
// import.meta.env fallback since the agent has no equivalent build-time env
// var — it's a runtime-only, same-machine service.
//
// PR #74 review round Fix 5: agentClient.ts builds every request URL by
// plain string concatenation (`${getAgentBaseUrl()}${path}`, `path` already
// leading-slashed) rather than a URL constructor, so a configured AGENT_URL
// carrying a trailing slash (an easy operator typo, or a value copy-pasted
// straight from a browser address bar) used to produce a double slash --
// "http://agent.test//print" -- a path most HTTP servers/routers treat as
// distinct from (and therefore never match to) "/print". Stripping any
// trailing slash(es) here, once, keeps every call site's simple
// concatenation correct without each of them needing to know about this.
export function getAgentBaseUrl(): string {
  const configured = window.__ENV__?.AGENT_URL;
  if (!configured) return "http://localhost:12345";
  return configured.replace(/\/+$/, "");
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

// Extracted (PR #81 bot round Finding C3) so useMonitorStream.ts's raw
// `fetch`-based SSE client -- which deliberately bypasses this `api` client
// for its streaming transport (see that file's own top-of-file comment) --
// can turn ITS non-OK responses into the exact same `ApiError` shape and
// route them through the app's global handling (handleApiError.ts),
// instead of silently reinventing (and inevitably drifting from) this
// parsing.
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { code?: string; error?: string; message?: string };
  return new ApiError(response.status, body.code, body.error || body.message || response.statusText);
}

const errors: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) {
      throw await apiErrorFromResponse(response);
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
