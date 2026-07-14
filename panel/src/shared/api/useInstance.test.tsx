import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useInstance } from "./useInstance";

describe("useInstance", () => {
  it("fetches GET /api/instance and resolves the mode", async () => {
    window.__ENV__ = { API_URL: "http://api.test" };
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify({ mode: "onprem", version: "1.0", license: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useInstance(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mode).toBe("onprem");
  });
});
