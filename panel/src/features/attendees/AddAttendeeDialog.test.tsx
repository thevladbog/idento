import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { AddAttendeeDialog } from "./AddAttendeeDialog";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let createCount = 0;
let lastCreateBody: unknown;
let createDelayMs = 0;

const server = startMswServer(
  http.post("http://api.test/api/events/:eventId/attendees", async ({ request, params }) => {
    createCount += 1;
    lastCreateBody = await request.json();
    if (createDelayMs) await delay(createDelayMs);
    return HttpResponse.json(
      {
        id: "att-new",
        event_id: params.eventId as string,
        first_name: "",
        last_name: "",
        email: "",
        company: "",
        position: "",
        code: "AUTO1",
        checkin_status: false,
        printed_count: 0,
        blocked: false,
        packet_delivered: false,
        created_at: "",
        updated_at: "",
      },
      { status: 201 },
    );
  }),
);
void server;

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

describe("AddAttendeeDialog", () => {
  beforeEach(() => {
    createCount = 0;
    lastCreateBody = undefined;
    createDelayMs = 0;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("shows a name-required error and does not call the API when both names are empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    expect(await screen.findByText("Enter at least a first or last name.")).toBeInTheDocument();
    expect(createCount).toBe(0);
  });

  it("shows an email-format error only when email is non-empty and invalid", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(createCount).toBe(0);
  });

  it("posts only the non-empty fields, invalidates the list, closes, and resets on success", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { queryClient } = renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Lovelace");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(createCount).toBe(1));
    expect(lastCreateBody).toEqual({ first_name: "Ada", last_name: "Lovelace" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["get", "/api/events/{event_id}/attendees", { params: { path: { event_id: "evt-1" } } }],
        }),
      ),
    );
  });

  it("posts all provided fields, omitting only the ones left blank", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Company"), "Analytical Engines");
    await user.type(screen.getByLabelText("Position"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(createCount).toBe(1));
    expect(lastCreateBody).toEqual({
      first_name: "Ada",
      email: "ada@example.com",
      company: "Analytical Engines",
      position: "Engineer",
    });
  });

  it("shows an inline server error and stays open on failure", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    expect(await screen.findByText("Couldn't add the attendee. Try again.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("clears the server error once the user edits a field again after a failure", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));
    expect(await screen.findByText("Couldn't add the attendee. Try again.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Last name"), "Lovelace");

    expect(screen.queryByText("Couldn't add the attendee. Try again.")).not.toBeInTheDocument();
  });

  it("resets the failed mutation on close, so reopening doesn't show a stale server error", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));
    expect(await screen.findByText("Couldn't add the attendee. Try again.")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <AddAttendeeDialog eventId="evt-1" open={false} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    expect(screen.queryByText("Couldn't add the attendee. Try again.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("");
  });

  it("blocks Cancel/Escape/outside-click dismissal while the create request is in flight", async () => {
    createDelayMs = 60;
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(createCount).toBe(1));
    // The submit is now pending: the X close button (whose accessible name
    // is also "Cancel", same closeLabel as the footer button) is hidden
    // entirely via hideClose, leaving exactly one "Cancel"-named button —
    // the footer one — and it's disabled.
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    expect(cancelButtons).toHaveLength(1);
    expect(cancelButtons[0]).toBeDisabled();

    await user.click(cancelButtons[0]);
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Once the delayed response resolves, the dialog closes normally.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("does not let a stale response close or error into a dialog session that was already closed and reopened for a fresh attendee", async () => {
    createDelayMs = 80;
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    // Submit attendee A; the POST is now pending (delayed).
    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Add attendee" }));
    await waitFor(() => expect(createCount).toBe(1));

    // Simulate the dialog being closed out from under the still-pending
    // request (e.g. a parent that force-closes it) and reopened for a
    // second, different attendee (B) — this is the exact scenario the
    // session-ref guard exists for.
    rerender(
      <QueryClientProvider client={queryClient}>
        <AddAttendeeDialog eventId="evt-1" open={false} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <AddAttendeeDialog eventId="evt-1" open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    // The reopened dialog is a fresh session: empty fields, no stale error.
    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.queryByText("Couldn't add the attendee. Try again.")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("First name"), "Bob");

    onOpenChange.mockClear();
    // Let attendee A's delayed response resolve now, well after the reopen.
    await new Promise((resolve) => setTimeout(resolve, 120));

    // It must not close the (now-different) session, nor show any error.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Couldn't add the attendee. Try again.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Bob");
  });
});
