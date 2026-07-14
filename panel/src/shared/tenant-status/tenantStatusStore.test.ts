import { tenantStatusStore } from "./tenantStatusStore";

describe("tenantStatusStore", () => {
  beforeEach(() => tenantStatusStore.setSuspended(false));

  it("defaults to not suspended", () => {
    expect(tenantStatusStore.isSuspended()).toBe(false);
  });

  it("setSuspended(true) flips the flag and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = tenantStatusStore.subscribe(listener);
    tenantStatusStore.setSuspended(true);
    expect(tenantStatusStore.isSuspended()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("does not notify subscribers when the value doesn't change", () => {
    tenantStatusStore.setSuspended(false);
    const listener = vi.fn();
    const unsubscribe = tenantStatusStore.subscribe(listener);
    tenantStatusStore.setSuspended(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
