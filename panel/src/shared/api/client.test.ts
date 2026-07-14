import { getInstance, login, loginWithQr, register, switchTenant } from "./client";
import { saveSession } from "./session";
import type { AuthResponse } from "./types";

const AUTH: AuthResponse = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme" }],
  current_tenant: { id: "t1", name: "Acme" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetchOnce(status: number, body: unknown) {
  // mockImplementation (not mockResolvedValue) so every call gets its own
  // fresh Response — a Response body can only be read once, and reusing a
  // single instance across multiple fetch calls in one test throws on the
  // second read.
  global.fetch = vi.fn().mockImplementation(() => jsonResponse(status, body));
}

// openapi-fetch calls the global fetch as `fetch(request: Request, init)`
// rather than `fetch(url, init)`, so assertions inspect the Request object
// it was actually called with instead of matching literal url/init args.
function requestSentTo(fetchMock: typeof fetch): Request {
  return (fetchMock as unknown as { mock: { calls: [Request, unknown][] } }).mock.calls[0][0];
}

describe("client", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("login POSTs /auth/login with email+password and returns the parsed body", async () => {
    mockFetchOnce(200, AUTH);
    const result = await login("a@b.com", "pw");
    const req = requestSentTo(fetch);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://api.test/auth/login");
    expect(await req.clone().text()).toBe(JSON.stringify({ email: "a@b.com", password: "pw" }));
    expect(result).toEqual(AUTH);
  });

  it("register POSTs /auth/register with tenant_name+email+password", async () => {
    mockFetchOnce(201, { ...AUTH, current_tenant: undefined });
    await register("Acme Events", "a@b.com", "pw");
    const req = requestSentTo(fetch);
    expect(req.url).toBe("http://api.test/auth/register");
    expect(await req.clone().text()).toBe(
      JSON.stringify({ tenant_name: "Acme Events", email: "a@b.com", password: "pw" }),
    );
  });

  it("loginWithQr POSTs /auth/login-qr with qr_token", async () => {
    mockFetchOnce(200, { token: "tok-1", user: AUTH.user });
    await loginWithQr("QR-123");
    const req = requestSentTo(fetch);
    expect(req.url).toBe("http://api.test/auth/login-qr");
    expect(await req.clone().text()).toBe(JSON.stringify({ qr_token: "QR-123" }));
  });

  it("getInstance GETs /api/instance without an Authorization header", async () => {
    mockFetchOnce(200, { mode: "saas", version: "1.0", license: null });
    const result = await getInstance();
    const req = requestSentTo(fetch);
    expect(req.headers.get("Authorization")).toBeNull();
    expect(result.mode).toBe("saas");
  });

  it("switchTenant attaches the Bearer token from session", async () => {
    saveSession(AUTH);
    mockFetchOnce(200, { token: "tok-2", current_tenant: AUTH.tenants[0] });
    await switchTenant("t1");
    const req = requestSentTo(fetch);
    expect(req.url).toBe("http://api.test/api/auth/switch-tenant");
    expect(req.headers.get("Authorization")).toBe("Bearer tok-1");
  });

  it("throws ApiError with the response's code and message on failure", async () => {
    mockFetchOnce(403, { code: "tenant_suspended", error: "This organization is suspended." });
    await expect(login("a@b.com", "wrong")).rejects.toMatchObject({
      status: 403,
      code: "tenant_suspended",
      message: "This organization is suspended.",
    });
  });
});
