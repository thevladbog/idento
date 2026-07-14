import { ApiError } from "../shared/api/ApiError";
import { getToken, saveSession } from "../shared/api/session";
import { tenantStatusStore } from "../shared/tenant-status/tenantStatusStore";
import { queryClient } from "./queryClient";

const AUTH = {
  token: "tok-1",
  user: { id: "u1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" },
  tenants: [{ id: "t1", name: "Acme" }],
  current_tenant: { id: "t1", name: "Acme" },
};

// jsdom's Location is a special exotic object whose own properties (assign,
// href, etc.) aren't configurable, so vi.spyOn(window.location, "assign")
// throws "Cannot redefine property". Delete + replace the whole `location`
// object instead, which jsdom does allow at the `window` level.
const realLocation = window.location;

function mockLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  // @ts-expect-error -- intentionally deleting a non-optional global for the mock swap
  delete window.location;
  window.location = { ...realLocation, assign } as Location;
  return assign;
}

function restoreLocation(): void {
  window.location = realLocation;
}

describe("queryClient — global ApiError handling", () => {
  beforeEach(() => {
    localStorage.clear();
    tenantStatusStore.setSuspended(false);
    queryClient.getMutationCache().clear();
    queryClient.getQueryCache().clear();
  });

  afterEach(() => {
    restoreLocation();
  });

  it("marks the tenant suspended when ANY mutation (not just a query) fails with tenant_suspended", async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new ApiError(403, "tenant_suspended", "Tenant is suspended")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();

    expect(tenantStatusStore.isSuspended()).toBe(true);
  });

  it("clears the session and redirects to /login on a non-auth mutation's 401 (dead session)", async () => {
    saveSession(AUTH);
    const assign = mockLocationAssign();

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new ApiError(401, undefined, "Session expired")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();

    expect(getToken()).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("does NOT clear the session for a login-tagged mutation's 401 (expected wrong-password rejection)", async () => {
    saveSession(AUTH);
    const assign = mockLocationAssign();

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["login"],
      mutationFn: () => Promise.reject(new ApiError(401, undefined, "Invalid credentials")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();

    expect(getToken()).toBe("tok-1");
    expect(assign).not.toHaveBeenCalled();
  });

  it("does NOT clear the session for a register-tagged mutation's 401", async () => {
    saveSession(AUTH);
    const assign = mockLocationAssign();

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["register"],
      mutationFn: () => Promise.reject(new ApiError(401, undefined, "Invalid credentials")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();

    expect(getToken()).toBe("tok-1");
    expect(assign).not.toHaveBeenCalled();
  });

  it("does NOT clear the session for a loginWithQr-tagged mutation's 401", async () => {
    saveSession(AUTH);
    const assign = mockLocationAssign();

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["loginWithQr"],
      mutationFn: () => Promise.reject(new ApiError(401, undefined, "Invalid QR token")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();

    expect(getToken()).toBe("tok-1");
    expect(assign).not.toHaveBeenCalled();
  });

  it("ignores non-ApiError failures", async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new Error("boom")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow("boom");

    expect(tenantStatusStore.isSuspended()).toBe(false);
  });
});
