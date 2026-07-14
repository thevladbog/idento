import { clearSession, getCurrentTenant, getCurrentUser, getToken, getTenants, hasSession, saveSession, updateCurrentTenant, updateToken } from "./session";
import type { AuthResponse } from "./types";

const AUTH: AuthResponse = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme" }, { id: "t2", name: "Other" }],
  current_tenant: { id: "t1", name: "Acme" },
};

describe("session", () => {
  beforeEach(() => localStorage.clear());

  it("has no session before saveSession", () => {
    expect(hasSession()).toBe(false);
    expect(getToken()).toBeNull();
  });

  it("saveSession persists token, user, tenants, current_tenant", () => {
    saveSession(AUTH);
    expect(hasSession()).toBe(true);
    expect(getToken()).toBe("tok-1");
    expect(getCurrentUser()).toEqual(AUTH.user);
    expect(getTenants()).toEqual(AUTH.tenants);
    expect(getCurrentTenant()).toEqual(AUTH.tenants[0]);
  });

  it("falls back to tenants[0] when current_tenant is absent (register response)", () => {
    saveSession({ ...AUTH, current_tenant: undefined });
    expect(getCurrentTenant()).toEqual(AUTH.tenants[0]);
  });

  it("clears a stale current_tenant when a later session has no tenant to fall back to (QR login)", () => {
    saveSession(AUTH);
    expect(getCurrentTenant()).toEqual(AUTH.current_tenant);

    saveSession({ ...AUTH, tenants: [], current_tenant: undefined });
    expect(getCurrentTenant()).toBeNull();
  });

  it("updateToken and updateCurrentTenant patch in place without touching user/tenants", () => {
    saveSession(AUTH);
    updateToken("tok-2");
    updateCurrentTenant({ id: "t2", name: "Other" });
    expect(getToken()).toBe("tok-2");
    expect(getCurrentTenant()).toEqual({ id: "t2", name: "Other" });
    expect(getCurrentUser()).toEqual(AUTH.user);
  });

  it("clearSession removes everything", () => {
    saveSession(AUTH);
    clearSession();
    expect(hasSession()).toBe(false);
    expect(getCurrentUser()).toBeNull();
    expect(getTenants()).toEqual([]);
    expect(getCurrentTenant()).toBeNull();
  });

  it("saveSession clears a stale parked impersonation session on a fresh login", () => {
    localStorage.setItem("impersonation", JSON.stringify({ tenantId: "t1", tenantName: "Acme", expiresAt: "2999-01-01", mintedAt: "2020-01-01" }));
    localStorage.setItem("operator_token", "operator-tok");

    saveSession(AUTH);

    expect(localStorage.getItem("impersonation")).toBeNull();
    expect(localStorage.getItem("operator_token")).toBeNull();
    expect(getToken()).toBe("tok-1");
  });

  it("getCurrentUser self-heals and returns null when stored JSON is malformed", () => {
    localStorage.setItem("user", "not valid json{{{");
    expect(getCurrentUser()).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("getTenants self-heals and returns [] when stored JSON is malformed", () => {
    localStorage.setItem("tenants", "not valid json{{{");
    expect(getTenants()).toEqual([]);
    expect(localStorage.getItem("tenants")).toBeNull();
  });

  it("getCurrentTenant self-heals and returns null when stored JSON is malformed", () => {
    localStorage.setItem("current_tenant", "not valid json{{{");
    expect(getCurrentTenant()).toBeNull();
    expect(localStorage.getItem("current_tenant")).toBeNull();
  });
});
