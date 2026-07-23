import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
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

  it("does not close or call onCheckedIn when the check-in verdict is blocked, and shows the inline blocked message", async () => {
    // The check-in endpoint is verdict-style: a blocked attendee still gets
    // an HTTP 200, just with outcome: "blocked" and checkin: null (nothing
    // was actually recorded server-side) -- this must NOT be treated like
    // the checked_in/already_checked_in success path above.
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin", () =>
        HttpResponse.json({
          outcome: "blocked",
          attendee: {
            id: "att-2", event_id: "evt-1", first_name: "Мария", last_name: "Иванова", email: "m@x.com",
            company: "ВТБ", code: "QR-11730", checkin_status: false, printed_count: 0, blocked: true,
            block_reason: "test", packet_delivered: false, created_at: "", updated_at: "",
          },
          checkin: null,
        })),
    );
    const user = userEvent.setup();
    const { onOpenChange, onCheckedIn } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Зарегистрировать" }));
    expect(await screen.findByText("Этот участник заблокирован, регистрация невозможна.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCheckedIn).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables Cancel and ignores Escape while the check-in request is still in flight", async () => {
    // A genuinely in-flight (delayed) request is what makes this test prove
    // anything -- with an instant response there's no window in which a
    // premature dismiss could race the mutation's onSuccess (same rationale
    // BulkBar.test.tsx's own "cannot be dismissed... while genuinely
    // running" test documents for its printDelayMs).
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin", async () => {
        await delay(40);
        return HttpResponse.json({ outcome: "checked_in", attendee: { id: "att-2" }, checkin: { at: "2026-01-01T00:00:00Z", by_email: "a@b.com" } });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange, onCheckedIn } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Зарегистрировать" }));

    // Cancel is disabled while pending -- guards the explicit Cancel path.
    const cancelButton = screen.getByRole("button", { name: "Отмена" });
    expect(cancelButton).toBeDisabled();

    // Escape is a no-op while pending -- guards the sheet's own dismissal
    // path (onEscapeKeyDown), not just the Cancel button.
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Once the mutation genuinely settles, both fire as normal.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCheckedIn).toHaveBeenCalledTimes(1);
  });

  // Regression: SheetContent's X close button is a Radix Dialog.Close --
  // it calls the Sheet Root's onOpenChange(false) directly, never going
  // through onEscapeKeyDown/onPointerDownOutside/onInteractOutside above,
  // so it needs its own guard (same race as the Cancel/Escape test above --
  // a delayed response is what makes this prove anything).
  it("ignores a click on the X close button while the check-in request is still in flight", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin", async () => {
        await delay(40);
        return HttpResponse.json({ outcome: "checked_in", attendee: { id: "att-2" }, checkin: { at: "2026-01-01T00:00:00Z", by_email: "a@b.com" } });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange, onCheckedIn } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Зарегистрировать" }));

    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCheckedIn).toHaveBeenCalledTimes(1);
  });
});
