import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AttendeeCard } from "./AttendeeCard";
import { startMswServer } from "../../test/msw";
import i18n from "../../shared/i18n";

const NOT_CHECKED_IN = {
  id: "att-2", event_id: "evt-1", first_name: "Мария", last_name: "Иванова", email: "m@x.com",
  company: "ВТБ", code: "QR-11730", checkin_status: false, printed_count: 0, blocked: false,
  packet_delivered: false, created_at: "", updated_at: "",
};

const CHECKED_IN = {
  id: "att-1", event_id: "evt-1", first_name: "Дмитрий", last_name: "Иванов", email: "d@x.com",
  company: "Яндекс", code: "QR-10482", checkin_status: true, checked_in_at: "2026-01-01T10:42:00Z",
  checked_in_point_name: "Kiosk A — Entrance", printed_count: 1, blocked: false,
  packet_delivered: false, created_at: "", updated_at: "",
};

// Registered once at module scope (matches AttendeeSearchList.test.tsx's own
// convention/comment on this exact hazard: calling `startMswServer(...)` from
// *inside* each `it()` body registers the server's beforeAll/afterEach/
// afterAll hooks too late for beforeAll to run before the request fires, so
// MSW never intercepts and every request falls through to a real failing
// network call). The GET /attendees/:id handler is the shared default for
// every "not checked in" test in this file (same fixture); a GET
// .../zone-access handler is included too -- AttendeeCard fetches zone
// access unconditionally via useAttendeeZoneAccess (only the checked-in
// variant renders it, but the hook still fires an HTTP request here) and
// `onUnhandledRequest: "error"` would otherwise fail every test on that
// unmocked request. The "checked in" describe block below overrides the
// GET /attendees/:id handler per-test via `server.use()` (this same file's
// captured `server`, NOT a second `startMswServer(...)` call -- see
// CheckInConfirmSheet.test.tsx's own comment on why a second module-scope
// `startMswServer` call would spin up an independent, non-overriding MSW
// server instance instead of actually overriding this one).
const server = startMswServer(
  http.get("http://api.test/api/attendees/:id", () => HttpResponse.json(NOT_CHECKED_IN)),
  http.get("http://api.test/api/attendees/:attendeeId/zone-access", () => HttpResponse.json([])),
);

function renderCard(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AttendeeCard eventId="evt-1" attendeeId="att-2" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("AttendeeCard — not checked in", () => {
  // Same beforeEach/afterEach locale-switch pattern as
  // CheckInConfirmSheet.test.tsx / AgentCard.test.tsx / PrinterWizard.test.tsx:
  // i18n is a shared singleton across test files, so it's switched here and
  // restored afterward rather than assumed. `window.__ENV__.API_URL` is set
  // per hooks.test.tsx's own beforeEach convention -- $api resolves its
  // baseUrl against it fresh per request (client.ts), so without this every
  // query falls through to the unmocked http://localhost:8008 default and
  // MSW never sees it.
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders identity, the not-checked-in chip, and the primary check-in button with its no-badge sub-label", async () => {
    renderCard();
    expect(await screen.findByText("Иванова Мария")).toBeInTheDocument();
    expect(screen.getByText(/ВТБ/)).toBeInTheDocument();
    expect(screen.getByText("Не зарегистрирован")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Зарегистрировать вручную/ });
    expect(button).toHaveTextContent("бейдж не будет напечатан");
  });

  it("opens the check-in confirm sheet when the primary button is tapped", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: /Зарегистрировать вручную/ }));
    expect(await screen.findByText("Зарегистрировать Иванова Мария?")).toBeInTheDocument();
  });

  it("calls onClose from the back control", async () => {
    const user = userEvent.setup();
    const { onClose } = renderCard();
    await user.click(await screen.findByRole("button", { name: "Назад" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives the primary check-in button an auto height so its two-line label never gets clipped", async () => {
    renderCard();
    const button = await screen.findByRole("button", { name: /Зарегистрировать вручную/ });
    expect(button.className).not.toMatch(/(^|\s)h-9(\s|$)/);
  });

  it("renders the QR view with no dead, accessible-name-less control", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: /Показать QR/ }));
    expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument();
  });
});

describe("AttendeeCard — checked in", () => {
  // Same locale-switch convention as the "not checked in" describe block
  // above. GET /attendees/:id is overridden here (via `server.use()`, not a
  // second `startMswServer(...)` call) to the CHECKED_IN fixture for every
  // test in this block; individual tests layer their own POST handler on
  // top for the mutation under test.
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    window.__ENV__ = { API_URL: "http://api.test" };
    server.use(http.get("http://api.test/api/attendees/:id", () => HttpResponse.json(CHECKED_IN)));
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the checked-in status card and the grouped actions list with Block isolated at the bottom", async () => {
    renderCard();
    expect(await screen.findByText("Зарегистрирован")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Показать QR участника/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отменить регистрацию/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Заблокировать/ })).toBeInTheDocument();
  });

  it("undoes the check-in through a confirm dialog", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin/undo", () => HttpResponse.json({ id: "att-1", checkin_status: false })),
    );
    const user = userEvent.setup();
    renderCard();
    // Only the row trigger matches this exact name before the dialog opens
    // -- the dialog's own confirm button (opened next) shares the same
    // label, so it's disambiguated below via `within(dialog)`.
    await user.click(await screen.findByRole("button", { name: "Отменить регистрацию" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Отменить регистрацию" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("blocks the attendee through a confirm dialog", async () => {
    server.use(
      http.post("http://api.test/api/attendees/:id/block", () => HttpResponse.json({ id: "att-1", blocked: true })),
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: /^Заблокировать$/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Заблокировать" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // Scope extension beyond the brief: Task 5's not-checked-in variant shipped
  // its own "Block" button as a stub (`onClick={() => {}}`). Block/unblock
  // wiring only landed with THIS task, so it's shared with the not-checked-in
  // branch too rather than left dangling -- an attendee can be blocked
  // whether or not they're checked in (design intent per board 8h/8i).
  it("blocks a not-yet-checked-in attendee through the same confirm dialog", async () => {
    server.use(
      http.get("http://api.test/api/attendees/:id", () => HttpResponse.json(NOT_CHECKED_IN)),
      http.post("http://api.test/api/attendees/:id/block", () => HttpResponse.json({ id: "att-2", blocked: true })),
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: /^Заблокировать$/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Заблокировать" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
