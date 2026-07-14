import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import { $api } from "./query";

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
