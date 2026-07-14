import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./ApiError";
import { api } from "./http";

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
