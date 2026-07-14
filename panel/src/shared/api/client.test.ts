import { getInstance, login, loginWithQr, register, switchTenant } from "./client";
import { saveSession } from "./session";
import type { AuthResponse } from "./types";

const AUTH: AuthResponse = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme" }],
  current_tenant: { id: "t1", name: "Acme" },
};

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("client", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("login POSTs /auth/login with email+password and returns the parsed body", async () => {
    mockFetchOnce(200, AUTH);
    const result = await login("a@b.com", "pw");
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "pw" }),
      }),
    );
    expect(result).toEqual(AUTH);
  });

  it("register POSTs /auth/register with tenant_name+email+password", async () => {
    mockFetchOnce(201, { ...AUTH, current_tenant: undefined });
    await register("Acme Events", "a@b.com", "pw");
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/auth/register",
      expect.objectContaining({
        body: JSON.stringify({ tenant_name: "Acme Events", email: "a@b.com", password: "pw" }),
      }),
    );
  });

  it("loginWithQr POSTs /auth/login-qr with qr_token", async () => {
    mockFetchOnce(200, { token: "tok-1", user: AUTH.user });
    await loginWithQr("QR-123");
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/auth/login-qr",
      expect.objectContaining({ body: JSON.stringify({ qr_token: "QR-123" }) }),
    );
  });

  it("getInstance GETs /api/instance without an Authorization header", async () => {
    mockFetchOnce(200, { mode: "saas", version: "1.0", license: null });
    const result = await getInstance();
    const [, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(result.mode).toBe("saas");
  });

  it("switchTenant attaches the Bearer token from session", async () => {
    saveSession(AUTH);
    mockFetchOnce(200, { token: "tok-2", current_tenant: AUTH.tenants[0] });
    await switchTenant("t1");
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/api/auth/switch-tenant",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok-1" }) }),
    );
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
