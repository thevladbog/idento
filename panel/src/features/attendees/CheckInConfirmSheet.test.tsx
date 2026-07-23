import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { CheckInConfirmSheet } from "./CheckInConfirmSheet";
import { startMswServer } from "../../test/msw";
import i18n from "../../shared/i18n";

// Registered with no default handlers, once at module scope -- each test
// installs its own POST /checkin handler via `server.use()` below (matches
// AttendeeSearchList.test.tsx's own convention/comment on this exact
// hazard: calling `startMswServer(...)` from *inside* each `it()` body
// registers the server's beforeAll/afterEach/afterAll hooks too late for
// beforeAll to run before the request fires, so MSW never intercepts and
// every request falls through to a real failing network call -- verified
// empirically here before this fix, same failure mode that file documents).
const server = startMswServer();

function renderSheet(onCheckedIn = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CheckInConfirmSheet
        eventId="evt-1"
        attendeeId="att-2"
        attendeeName="Иванова Мария"
        open
        onOpenChange={onOpenChange}
        onCheckedIn={onCheckedIn}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onCheckedIn };
}

describe("CheckInConfirmSheet", () => {
  // All assertions in this suite check the RU copy renders (the sheet's
  // RU strings, not just the attendee's own Cyrillic name) -- same
  // beforeEach/afterEach locale-switch pattern as AgentCard.test.tsx and
  // PrinterWizard.test.tsx: i18n is a shared singleton across test files,
  // so it's switched here and restored afterward rather than assumed.
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    // Matches attendees/hooks.test.tsx's own beforeEach: $api resolves its
    // baseUrl against window.__ENV__.API_URL per-request (client.ts), so
    // without this every mutation.mutate() call falls through to the
    // unmocked http://localhost:8008 default and MSW never sees it.
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the title with the attendee name and the structural no-badge notice", () => {
    renderSheet();
    expect(screen.getByText("Зарегистрировать Иванова Мария?")).toBeInTheDocument();
    expect(screen.getByText("Бейдж не будет напечатан.")).toBeInTheDocument();
  });

  it("checks the attendee in with no station_id and closes + calls onCheckedIn on success", async () => {
    let capturedBody: unknown;
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ outcome: "checked_in", attendee: { id: "att-2" }, checkin: { at: "2026-01-01T00:00:00Z", by_email: "a@b.com" } });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange, onCheckedIn } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Зарегистрировать" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCheckedIn).toHaveBeenCalledTimes(1);
    expect(capturedBody).toEqual({ attendee_id: "att-2" });
  });

  it("shows an inline error and stays open when the check-in request fails", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    const { onOpenChange } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Зарегистрировать" }));
    expect(await screen.findByText("Не удалось зарегистрировать. Попробуйте ещё раз.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
