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
});
