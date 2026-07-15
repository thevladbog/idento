import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
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
let deleteDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/events", () => {
    listHitCount += 1;
    return HttpResponse.json([]);
  }),
  http.delete("http://api.test/api/events/:id", async ({ params }) => {
    deleteCount += 1;
    lastDeletedId = params.id as string;
    if (deleteDelayMs) await delay(deleteDelayMs);
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
    deleteDelayMs = 0;
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

  it("keeps the dialog open with the error shown inside it and the typed name preserved when the delete fails, then a retry from that same dialog succeeds", async () => {
    deleteStatusOverride = 500;
    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const dialog = await screen.findByRole("dialog");
    const input = screen.getByLabelText("Type Partner Day — Autumn to confirm");
    await user.type(input, "Partner Day — Autumn");
    await user.click(within(dialog).getByRole("button", { name: "Delete event" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    // The failure must NOT auto-close the dialog — ConfirmDialog wipes its
    // typed input on any close, and this is a typed-confirmation flow, so
    // auto-closing on a transient failure would force a full, exact,
    // case-sensitive retype for no reason.
    expect(await within(dialog).findByText("Couldn't delete the event. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(input).toHaveValue("Partner Day — Autumn");
    expect(navigateMock).not.toHaveBeenCalled();

    // Retry from the same still-open dialog — no retyping needed.
    deleteStatusOverride = null;
    await user.click(within(dialog).getByRole("button", { name: "Delete event" }));

    await waitFor(() => expect(deleteCount).toBe(2));
    expect(lastDeletedId).toBe("evt-1");
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clears the error and closes normally when the user explicitly clicks Cancel after a failure", async () => {
    deleteStatusOverride = 500;
    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("Type Partner Day — Autumn to confirm"), "Partner Day — Autumn");
    await user.click(within(dialog).getByRole("button", { name: "Delete event" }));

    expect(await within(dialog).findByText("Couldn't delete the event. Please try again.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Couldn't delete the event. Please try again.")).not.toBeInTheDocument();

    // Reopening starts a genuinely fresh attempt: no stale error, no stale
    // typed input, confirm disabled until the name is retyped.
    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).queryByText("Couldn't delete the event. Please try again.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type Partner Day — Autumn to confirm")).toHaveValue("");
    expect(within(reopened).getByRole("button", { name: "Delete event" })).toBeDisabled();
  });

  // Regression test for the cancel-during-pending race (same class as
  // ApiKeysCard's create-dialog fix): the DELETE is still in flight when the
  // user clicks Cancel. `deleteEvent.reset()` on close only detaches the
  // mutation observer — it does not abort the in-flight request or stop
  // `onSuccess`/`onError` from firing once the response lands late. Pre-fix,
  // that late `onSuccess` still force-navigated the user to Home for a
  // delete they believed they'd cancelled, and a late `onError` would have
  // surfaced a card-level error the user never expected to see again — the
  // abort guard correctly suppresses both of those UI-visible reactions.
  // Cache invalidation is a different matter: the event is genuinely deleted
  // server-side either way (that can't be un-cancelled from the client), so
  // the events-list query must still be invalidated even though the dialog
  // was aborted — otherwise the list would keep showing a phantom deleted
  // event. See DangerZoneCard.tsx's onSuccess for why invalidation runs
  // unconditionally, before the abort-ref check.
  it("still invalidates the events list, but does not navigate or surface an error, if the confirm dialog is closed (Cancel) before a pending DELETE resolves", async () => {
    deleteDelayMs = 50;
    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);
    await waitFor(() => expect(listHitCount).toBe(1));

    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("Type Partner Day — Autumn to confirm"), "Partner Day — Autumn");
    await user.click(within(dialog).getByRole("button", { name: "Delete event" }));

    // Cancel while the delayed DELETE is still in flight (the Cancel button
    // is never disabled by `confirmDisabled`, unlike the confirm button).
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Let the delayed response land well after the close.
    await waitFor(() => expect(deleteCount).toBe(1));
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Couldn't delete the event. Please try again.")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Regression test for the SECOND cancel-then-reopen race (same class as
  // ApiKeysCard's equivalent create-session test): a plain boolean ref reset
  // on every reopen can't distinguish "a response from THIS session" from "a
  // response from a PREVIOUSLY-cancelled session" once the dialog has been
  // reopened at least once. The first (already-cancelled) delete's late
  // response must never navigate or surface an error, even after a second
  // delete is submitted from a reopened dialog.
  it("never navigates or surfaces an error from a FIRST cancelled delete, even after a second delete is submitted following a reopen", async () => {
    let callIndex = 0;
    server.use(
      http.delete("http://api.test/api/events/:id", async ({ params }) => {
        callIndex += 1;
        const index = callIndex;
        deleteCount += 1;
        lastDeletedId = params.id as string;
        // First (already-cancelled) delete resolves well AFTER the second.
        await delay(index === 1 ? 150 : 20);
        if (index === 1) {
          // Simulate the aborted attempt's response landing late as an
          // error — this must not surface after the reopen either.
          return HttpResponse.json({ error: "server error" }, { status: 500 });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DangerZoneCard event={EVENT} />);
    await waitFor(() => expect(listHitCount).toBe(1));

    // First attempt: open, type, confirm, then cancel while still pending.
    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("Type Partner Day — Autumn to confirm"), "Partner Day — Autumn");
    await user.click(within(dialog).getByRole("button", { name: "Delete event" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen and submit a second, current delete — before the first
    // request's delayed response has landed.
    await user.click(screen.getByRole("button", { name: "Delete event…" }));
    dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("Type Partner Day — Autumn to confirm"), "Partner Day — Autumn");
    await user.click(within(dialog).getByRole("button", { name: "Delete event" }));

    // The second (current) delete resolves first and navigates home.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/" }));

    // Now let the first (already-cancelled) delete's late error response
    // land too — it must not surface anywhere, since the user is already
    // gone from this screen in a real app (simulated here by the card still
    // being mounted).
    await waitFor(() => expect(deleteCount).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Couldn't delete the event. Please try again.")).not.toBeInTheDocument();
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
