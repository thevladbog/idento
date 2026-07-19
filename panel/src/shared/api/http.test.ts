import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./ApiError";
import { api, getAgentBaseUrl, getApiBaseUrl } from "./http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client middleware", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches Authorization header when a token exists", async () => {
    localStorage.setItem("token", "jwt-123");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { user_id: "u", tenant_id: "t", role: "admin" }));
    await api.GET("/api/me");
    const req = fetchSpy.mock.calls[0][0] as Request;
    expect(req.headers.get("Authorization")).toBe("Bearer jwt-123");
  });

  it("does not attach Authorization without a token", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { mode: "saas", version: "v1", license: null }));
    await api.GET("/api/instance");
    const req = fetchSpy.mock.calls[0][0] as Request;
    expect(req.headers.get("Authorization")).toBeNull();
  });

  it("throws ApiError with code on non-ok responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(403, { code: "tenant_suspended", error: "suspended" }),
    );
    await expect(api.GET("/api/me")).rejects.toMatchObject(
      new ApiError(403, "tenant_suspended", "suspended"),
    );
  });

  it("throws ApiError with statusText when the error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("gateway timeout", { status: 504, statusText: "Gateway Timeout" }),
    );
    await expect(api.GET("/api/me")).rejects.toBeInstanceOf(ApiError);
  });
});

// PR #74 review round Fix 5: agentClient.ts builds request URLs by plain
// string concatenation (`${getAgentBaseUrl()}${path}`, path already
// leading-slashed) -- an AGENT_URL configured WITH a trailing slash (an easy
// operator typo, or a value copy-pasted from a browser address bar) used to
// produce a double-slash ("http://agent.test//print") that most HTTP
// servers/routers treat as a distinct, unmatched path from "/print".
describe("getAgentBaseUrl", () => {
  afterEach(() => {
    window.__ENV__ = undefined;
  });

  it("strips a trailing slash from a configured AGENT_URL", () => {
    window.__ENV__ = { AGENT_URL: "http://agent.test/" };
    expect(getAgentBaseUrl()).toBe("http://agent.test");
  });

  it("strips multiple trailing slashes", () => {
    window.__ENV__ = { AGENT_URL: "http://agent.test///" };
    expect(getAgentBaseUrl()).toBe("http://agent.test");
  });

  it("leaves an already-clean AGENT_URL untouched", () => {
    window.__ENV__ = { AGENT_URL: "http://agent.test" };
    expect(getAgentBaseUrl()).toBe("http://agent.test");
  });

  it("falls back to the dev-machine default when unset", () => {
    window.__ENV__ = undefined;
    expect(getAgentBaseUrl()).toBe("http://localhost:12345");
  });
});

// PR #81 bot round Finding C2: useMonitorStream.ts builds its SSE request
// URL by plain string concatenation (`${getApiBaseUrl()}/api/events/...`,
// the exact bug class Fix 5 above fixed for AGENT_URL) since it bypasses
// the `api` openapi-fetch client for its streaming transport (see that
// file's own top-of-file comment). openapi-fetch's `baseUrl` handling
// already tolerates a trailing slash internally (`removeTrailingSlash` in
// openapi-fetch/dist -- verified against the installed 0.17.0), and
// `dynamicBaseUrl` in this file only ever copies protocol/hostname/port
// from `getApiBaseUrl()`, never the pathname, so normalizing HERE is safe
// for every existing consumer and fixes the one raw-`fetch` caller that
// isn't otherwise protected.
describe("getApiBaseUrl", () => {
  afterEach(() => {
    window.__ENV__ = undefined;
  });

  it("strips a trailing slash from a configured API_URL", () => {
    window.__ENV__ = { API_URL: "http://api.test/" };
    expect(getApiBaseUrl()).toBe("http://api.test");
  });

  it("strips multiple trailing slashes", () => {
    window.__ENV__ = { API_URL: "http://api.test///" };
    expect(getApiBaseUrl()).toBe("http://api.test");
  });

  it("leaves an already-clean API_URL untouched", () => {
    window.__ENV__ = { API_URL: "http://api.test" };
    expect(getApiBaseUrl()).toBe("http://api.test");
  });

  it("falls back to the dev-machine default when unset", () => {
    window.__ENV__ = undefined;
    expect(getApiBaseUrl()).toBe("http://localhost:8008");
  });
});
