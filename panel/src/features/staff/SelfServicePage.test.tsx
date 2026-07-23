import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { SelfServicePage } from "./SelfServicePage";
import { startMswServer } from "../../test/msw";
import i18n from "../../shared/i18n";

// Partial mock (`importOriginal`), not a full replacement: `shared/api/http`'s
// `auth` middleware imports `getToken` from this same module and runs on
// EVERY request (including this test's QR-token mutation) — a full
// `vi.mock` that only supplies `getCurrentUser`/`clearSession` leaves
// `getToken` undefined, which throws inside that middleware before the
// request ever reaches MSW (surfaces as a spurious mutation error, not a
// missing mock). Same fix as AddStationAction.test.tsx's own comment on
// this exact hazard.
vi.mock("../../shared/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api/session")>();
  return {
    ...actual,
    getCurrentUser: () => ({ id: "user-1", tenant_id: "t1", email: "anna@x.com", role: "staff", created_at: "", updated_at: "" }),
    clearSession: vi.fn(),
  };
});

// Registered once at module scope (matches AttendeeCard.test.tsx's own
// convention/comment on this exact hazard: calling `startMswServer(...)`
// from *inside* an `it()` body registers the server's beforeAll hook too
// late for it to run before the request fires, so MSW never intercepts and
// the request falls through to a real failing network call instead).
const server = startMswServer(
  http.post("http://api.test/api/users/:id/qr-token", () =>
    HttpResponse.json({ qr_token: "self-tok-1", user_id: "user-1", email: "anna@x.com" }),
  ),
);
void server;

// Same locale-switch convention as CheckInConfirmSheet.test.tsx / AgentCard.test.tsx /
// PrinterWizard.test.tsx / AttendeeCard.test.tsx: i18n is a shared singleton
// across test files, so it's switched here and restored afterward rather than
// assumed (the panel's default test locale is English). `window.__ENV__.API_URL`
// is set per StaffCard.test.tsx/StaffPage.test.tsx's own beforeEach convention --
// $api resolves its baseUrl against it fresh per request (client.ts), so
// without this every query falls through to the unmocked
// http://localhost:8008 default and MSW never sees it.
beforeEach(async () => {
  await i18n.changeLanguage("ru");
  window.__ENV__ = { API_URL: "http://api.test" };
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SelfServicePage />
    </QueryClientProvider>,
  );
}

describe("SelfServicePage", () => {
  it("renders the current user's email and a Show my login QR action", () => {
    renderPage();
    expect(screen.getByText("anna@x.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать мой QR для входа" })).toBeInTheDocument();
  });

  it("mints a token and shows the full-screen QR when tapped", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Показать мой QR для входа" }));
    expect(await screen.findByRole("img", { name: "self-tok-1" })).toBeInTheDocument();
  });
});
