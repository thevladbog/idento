import { createMemoryHistory } from "@tanstack/react-router";
import { queryClient } from "./queryClient";
import { router } from "./router";

// openapi-fetch (Task 10) reads `.headers`/`.clone()` off the fetch Response,
// so mocks need real Response instances rather than bare `{ok,status,json}`
// objects.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("router — /register edition guard", () => {
  beforeEach(() => {
    queryClient.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("redirects /register to /login when the instance is on-prem", async () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse(200, { mode: "onprem", version: "1.0", license: null }));
    router.update({ history: createMemoryHistory({ initialEntries: ["/register"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("allows /register to load when the instance is saas", async () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse(200, { mode: "saas", version: "1.0", license: null }));
    router.update({ history: createMemoryHistory({ initialEntries: ["/register"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/register");
  });

  it("redirects /register to /login when the instance lookup fails (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    router.update({ history: createMemoryHistory({ initialEntries: ["/register"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });
});
