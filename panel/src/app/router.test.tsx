import { createMemoryHistory } from "@tanstack/react-router";
import { queryClient } from "./queryClient";
import { router } from "./router";

describe("router — /register edition guard", () => {
  beforeEach(() => {
    queryClient.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("redirects /register to /login when the instance is on-prem", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ mode: "onprem", version: "1.0", license: null }),
    });
    router.update({ history: createMemoryHistory({ initialEntries: ["/register"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("allows /register to load when the instance is saas", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ mode: "saas", version: "1.0", license: null }),
    });
    router.update({ history: createMemoryHistory({ initialEntries: ["/register"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/register");
  });
});
