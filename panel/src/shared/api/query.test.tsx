import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { startMswServer } from "../../test/msw";

// `./query` -> `./http` reads `window.__ENV__` once, at module-load time
// (see the "resolves its baseUrl once" comment in ./client.ts — the same
// staleness applies here, and $api has no per-call baseUrl override like
// client.ts's hand-written calls do). In the real app this is harmless
// because index.html sets `window.__ENV__` in an inline <script> before the
// bundle loads. `vi.hoisted` reproduces that ordering here: it is guaranteed
// to run before this file's imports are evaluated, so `./http`'s
// module-load-time `getApiBaseUrl()` call sees "http://api.test" instead of
// falling back to "http://localhost:8008" — which is what MSW reported as
// an unhandled request (onUnhandledRequest: "error") before this fix.
vi.hoisted(() => {
  window.__ENV__ = { API_URL: "http://api.test" };
});

const { $api } = await import("./query");

const server = startMswServer(
  http.get("http://api.test/api/events", () =>
    HttpResponse.json([{ id: "e1", tenant_id: "t1", name: "Conf", created_at: "", updated_at: "" }]),
  ),
);
void server;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("$api", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("runs a typed GET query through the shared client (auth middleware included)", async () => {
    const { result } = renderHook(() => $api.useQuery("get", "/api/events"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.name).toBe("Conf");
  });
});
