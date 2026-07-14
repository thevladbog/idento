import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { DangerZoneCard } from "./DangerZoneCard";
import { $api } from "../../../shared/api/query";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";
import type { components } from "../../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

// DangerZoneCard navigates to Home via `useNavigate` (TanStack Router) after
// a successful delete. Mocked the same way CreateEventDialog.test.tsx does,
// for the same reason: asserting the exact navigation args without standing
// up a full router harness with a registered "/" route.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const EVENT: ApiEvent = {
  id: "evt-1",
  tenant_id: "t1",
  name: "Partner Day — Autumn",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

let listHitCount = 0;
let deleteCount = 0;
let lastDeletedId: string | undefined;
let deleteStatusOverride: number | null = null;

const server = startMswServer(
  http.get("http://api.test/api/events", () => {
    listHitCount += 1;
    return HttpResponse.json([]);
  }),
  http.delete("http://api.test/api/events/:id", ({ params }) => {
    deleteCount += 1;
    lastDeletedId = params.id as string;
    if (deleteStatusOverride) {
      return HttpResponse.json({ error: "server error" }, { status: deleteStatusOverride });
    }
    // deleteEvent's actual schema.d.ts response is 204 No Content (verified
    // against backend/internal/handler/events.go's c.NoContent call) — unlike
    // Tasks 5/6's fonts/api-keys endpoints, this one's 204 claim holds.
    return new HttpResponse(null, { status: 204 });
  }),
);
void server;

// Keeps the events-list query active (an observer subscribed to it) so that
// `queryClient.invalidateQueries` on that key actually triggers a refetch we
// can observe via `listHitCount`, mirroring how Home would behave in the
// real app. DangerZoneCard itself never fetches this query.
function ListObserver() {
  $api.useQuery("get", "/api/events");
  return null;
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ListObserver />
      {ui}
    </QueryClientProvider>,
  );
}

describe("DangerZoneCard", () => {
  beforeEach(() => {
    listHitCount = 0;
    deleteCount = 0;
    lastDeletedId = undefined;
    deleteStatusOverride = null;
    navigateMock.mockClear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("renders a destructive-tinted card with the delete-event row", async () => {
    renderWithProviders(<DangerZoneCard event={EVENT} />);

    const heading = await screen.findByRole("heading", { name: "Danger zone" });
    expect(heading.className).toContain("text-destructive");
    expect(heading.closest("div.rounded-lg")?.className).toContain("border-destructive/30");

    expect(screen.getByText("Delete this event")).toBeInTheDocument();
    expect(
      screen.getByText("Attendees, check-in history and the badge design — gone. Typed confirmation required."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete event…" })).toBeInTheDocument();
  });

  it("keeps the confirm button disabled until the exact event name is typed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const dialog = await screen.findByRole("dialog");

    const confirmButton = screen.getByRole("button", { name: "Delete event" });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByLabelText("Type Partner Day — Autumn to confirm");
    await user.type(input, "Partner Day");
    expect(confirmButton).toBeDisabled();

    await user.type(input, " — Autumn");
    expect(confirmButton).toBeEnabled();

    // A near-miss (wrong case/whitespace) must not satisfy the exact match.
    await user.clear(input);
    await user.type(input, "partner day — autumn");
    expect(confirmButton).toBeDisabled();

    void dialog;
    expect(deleteCount).toBe(0);
  });

  it("deletes on confirm: DELETE with the correct id, navigates home, and invalidates the events list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);
    await waitFor(() => expect(listHitCount).toBe(1));

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const input = screen.getByLabelText("Type Partner Day — Autumn to confirm");
    await user.type(input, "Partner Day — Autumn");
    await user.click(screen.getByRole("button", { name: "Delete event" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    expect(lastDeletedId).toBe("evt-1");

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/" }));
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows an inline error in the card when the delete fails, and clears it after closing and reopening", async () => {
    deleteStatusOverride = 500;
    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    let input = screen.getByLabelText("Type Partner Day — Autumn to confirm");
    await user.type(input, "Partner Day — Autumn");
    await user.click(screen.getByRole("button", { name: "Delete event" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    expect(await screen.findByText("Couldn't delete the event. Please try again.")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();

    // Reopen without closing first — the dialog auto-closes on failure (same
    // convention as ApiKeysCard's revoke flow, so the inline card error
    // below the modal is actually visible) and the error must persist until
    // the user starts a fresh attempt.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    deleteStatusOverride = null;
    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    expect(screen.queryByText("Couldn't delete the event. Please try again.")).not.toBeInTheDocument();

    input = screen.getByLabelText("Type Partner Day — Autumn to confirm");
    await user.type(input, "Partner Day — Autumn");
    await user.click(screen.getByRole("button", { name: "Delete event" }));

    await waitFor(() => expect(deleteCount).toBe(2));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/" }));
  });

  it("disables the confirm button while the delete is pending, to prevent a double DELETE", async () => {
    const user = userEvent.setup();
    server.use(
      http.delete("http://api.test/api/events/:id", async () => {
        deleteCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<DangerZoneCard event={EVENT} />);

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const input = screen.getByLabelText("Type Partner Day — Autumn to confirm");
    await user.type(input, "Partner Day — Autumn");
    const confirmButton = screen.getByRole("button", { name: "Delete event" });
    await user.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    await waitFor(() => expect(deleteCount).toBe(1));
  });
});
