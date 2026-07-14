import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { CreateEventDialog } from "./CreateEventDialog";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

// CreateEventDialog navigates via `useNavigate` (TanStack Router) on a
// successful create. Rather than standing up a full router harness with the
// real event route just to resolve that call, mock the hook directly — the
// dialog doesn't render any `Link`s, so nothing else from the module is
// needed. This lets tests assert the exact navigation args without depending
// on router internals.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let createCount = 0;
let lastCreateBody: unknown;

const server = startMswServer(
  http.post("http://api.test/api/events", async ({ request }) => {
    createCount += 1;
    lastCreateBody = await request.json();
    const body = lastCreateBody as { name: string };
    return HttpResponse.json(
      { id: "evt-new", tenant_id: "t1", name: body.name, created_at: "", updated_at: "" },
      { status: 201 },
    );
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("CreateEventDialog", () => {
  beforeEach(() => {
    createCount = 0;
    lastCreateBody = undefined;
    navigateMock.mockClear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("shows a required-name error and does not call the API when submitted empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateEventDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText("Give the event a name.")).toBeInTheDocument();
    expect(createCount).toBe(0);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows a dates-order error and does not call the API when end date precedes start date", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateEventDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Event name"), "Conference");
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-08-01" } });
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText("End date can't be before the start date.")).toBeInTheDocument();
    expect(createCount).toBe(0);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("posts the correct body and navigates to the created event on valid submit", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<CreateEventDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText("Event name"), "Annual Conference");
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-08-05" } });
    await user.type(screen.getByLabelText("Location"), "Berlin");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createCount).toBe(1));
    expect(lastCreateBody).toEqual({
      name: "Annual Conference",
      start_date: new Date("2026-08-01").toISOString(),
      end_date: new Date("2026-08-05").toISOString(),
      location: "Berlin",
    });

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: "/events/$eventId", params: { eventId: "evt-new" } }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("omits empty date/location fields from the request body", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateEventDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Event name"), "Minimal Event");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createCount).toBe(1));
    expect(lastCreateBody).toEqual({ name: "Minimal Event" });
  });

  it("shows a localized error (not zod's raw English message) when location is too long", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateEventDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Event name"), "Conference");
    await user.type(screen.getByLabelText("Location"), "x".repeat(301));
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText("Keep the location under 300 characters.")).toBeInTheDocument();
    expect(screen.queryByText(/String must contain/)).not.toBeInTheDocument();
    expect(createCount).toBe(0);
  });

  it("resets the failed create mutation on close, so reopening doesn't show a stale server error", async () => {
    server.use(http.post("http://api.test/api/events", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    // A single shared QueryClient across the whole open->close->open cycle
    // (via `rerender` on the same tree, not a fresh render) is essential:
    // this is what actually exercises `createEvent.reset()` on close — a
    // brand-new QueryClient per rerender would clear the stale error for
    // free and the test would pass even without the fix.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CreateEventDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("Event name"), "Will Fail");
    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByText("Couldn't create the event. Please try again.")).toBeInTheDocument();

    // Close, then reopen — the failed mutation's error state must not carry
    // over into the fresh attempt.
    rerender(
      <QueryClientProvider client={queryClient}>
        <CreateEventDialog open={false} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <CreateEventDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    expect(screen.queryByText("Couldn't create the event. Please try again.")).not.toBeInTheDocument();
  });
});
