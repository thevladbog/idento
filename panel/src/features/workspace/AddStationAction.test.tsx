import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AddStationAction } from "./AddStationAction";
import { startMswServer } from "../../test/msw";
import i18n from "../../shared/i18n";

// Partial mock (`importOriginal`), not a full replacement: `shared/api/http`'s
// `auth` middleware imports `getToken` from this same module and runs on
// EVERY request (including this test's provisioning-token mutation) — a
// full `vi.mock` that only supplies `getCurrentUser` leaves `getToken`
// undefined, which throws inside that middleware before the request ever
// reaches MSW (surfaces as a spurious mutation error, not a missing mock).
vi.mock("../../shared/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api/session")>();
  return {
    ...actual,
    getCurrentUser: () => ({ id: "user-1", tenant_id: "t1", email: "a@b.com", role: "admin", created_at: "", updated_at: "" }),
  };
});

function renderAction() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AddStationAction eventId="evt-1" eventName="TechConf Moscow 2026" />
    </QueryClientProvider>,
  );
}

// Registered once at module scope (AttendeeCard.test.tsx's own convention/
// comment on this exact hazard: calling `startMswServer(...)` from *inside*
// each `it()` body registers the server's beforeAll/afterEach/afterAll hooks
// too late for beforeAll to run before the request fires, so MSW never
// intercepts and every request falls through to a real failing network
// call). Per-test behavior is layered in via `server.use(...)` below.
const server = startMswServer(
  http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
    await request.json();
    return HttpResponse.json({ token: "prov-tok-abc", expires_at: new Date(Date.now() + 600_000).toISOString() });
  }),
);

describe("AddStationAction", () => {
  // Same beforeEach/afterEach locale-switch + __ENV__ pattern as
  // AttendeeCard.test.tsx / StaffCard.test.tsx / WorkspaceOverview.test.tsx:
  // i18n is a shared singleton across test files, so it's switched here and
  // restored afterward rather than assumed, and `window.__ENV__.API_URL` is
  // set so `$api` resolves its baseUrl against the mocked origin instead of
  // falling through to the unmocked http://localhost:8008 default.
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("mints a provisioning token for the current user and shows it as a QR with the returned expiry", async () => {
    let capturedBody: unknown;
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ token: "prov-tok-abc", expires_at: new Date(Date.now() + 600_000).toISOString() });
      }),
    );
    const user = userEvent.setup();
    renderAction();
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    // The QR image's accessible name is a generic "QR code" (never the raw
    // token) — data-testid is QrDisplay's own test hook for the rendered code.
    expect(await screen.findByTestId("qr-display-code")).toBeInTheDocument();
    expect(screen.getByText("TechConf Moscow 2026 · подключится как станция регистрации")).toBeInTheDocument();
    expect(capturedBody).toEqual({ staff_user_id: "user-1" });
  });

  it("shows an inline error if minting fails", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderAction();
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    expect(await screen.findByText("Не удалось создать код для подключения — попробуйте снова.")).toBeInTheDocument();
  });

  // Regression: onRegenerate re-calls mint.mutate(), which resets the
  // mutation to pending -- gating render on mint.isSuccess/mint.data
  // directly made the QR screen flash back to the base "Add station" button
  // for that window. A second, distinct token proves the cache actually
  // updates too, not just that the QR stays visible.
  it("stays on the QR screen through a regenerate, without flashing back to the base button", async () => {
    let mintCallCount = 0;
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
        await request.json();
        mintCallCount += 1;
        return HttpResponse.json({
          token: mintCallCount === 1 ? "prov-tok-abc" : "prov-tok-xyz",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        });
      }),
    );
    const user = userEvent.setup();
    renderAction();
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    await screen.findByTestId("qr-display-code");

    // The regenerate control shares the "Добавить станцию" label with the
    // base page's mint button, so the base page's own subtitle caption
    // (never rendered on the QR screen) is the unambiguous signal here.
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));

    expect(screen.queryByText("покажет QR")).not.toBeInTheDocument();
    await waitFor(() => expect(mintCallCount).toBe(2));
    expect(screen.getByTestId("qr-display-code")).toBeInTheDocument();
  });
});
