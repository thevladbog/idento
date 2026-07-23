import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

// Registered once at module scope (matches AttendeeSearchList.test.tsx's own
// convention/comment on this exact hazard: calling `startMswServer(...)` from
// *inside* each `it()` body registers the server's beforeAll/afterEach/
// afterAll hooks too late for beforeAll to run before the request fires, so
// MSW never intercepts and every request falls through to a real failing
// network call). The GET /attendees/:id handler is shared by every test in
// this file (same fixture); a GET .../zone-access handler is included too --
// AttendeeCard fetches zone access unconditionally via useAttendeeZoneAccess
// (only Task 6's checked-in variant renders it, but the hook still fires an
// HTTP request here) and `onUnhandledRequest: "error"` would otherwise fail
// every test on that unmocked request.
startMswServer(
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
