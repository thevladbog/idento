import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { DangerZoneCard } from "./DangerZoneCard";
import { useAttendeesPage } from "../../attendees/hooks";
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

let attendeesListHitCount = 0;
let generateCodesCount = 0;
let lastGenerateCodesEventId: string | undefined;
let generateCodesStatusOverride: number | null = null;
let generateCodesUpdatedCount = 3;
let generateCodesDelayMs = 0;

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
  // AttendeesListObserver below keeps this query actively subscribed so
  // ATTENDEES_LIST_KEY invalidation is observable via a hit-count bump,
  // same pattern as the events-list ListObserver above.
  http.get("http://api.test/api/events/:eventId/attendees", () => {
    attendeesListHitCount += 1;
    return HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 });
  }),
  http.post("http://api.test/api/events/:eventId/attendees/generate-codes", async ({ params }) => {
    generateCodesCount += 1;
    lastGenerateCodesEventId = params.eventId as string;
    if (generateCodesDelayMs) await delay(generateCodesDelayMs);
    if (generateCodesStatusOverride) {
      return HttpResponse.json({ error: "server error" }, { status: generateCodesStatusOverride });
    }
    return HttpResponse.json({
      status: "ok",
      updated_count: generateCodesUpdatedCount,
      message: "done",
    });
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

// Same ListObserver pattern as above (and as AttendeeDrawer.test.tsx's own
// AttendeesListObserver): keeps the attendees list query actively
// subscribed so `queryClient.invalidateQueries` on ATTENDEES_LIST_KEY
// actually triggers an observable refetch we can assert on via
// `attendeesListHitCount`.
function AttendeesListObserver() {
  useAttendeesPage(EVENT.id, { page: 1 });
  return null;
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ListObserver />
      <AttendeesListObserver />
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
    attendeesListHitCount = 0;
    generateCodesCount = 0;
    lastGenerateCodesEventId = undefined;
    generateCodesStatusOverride = null;
    generateCodesUpdatedCount = 3;
    generateCodesDelayMs = 0;
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

  describe("generate missing codes row", () => {
    it("renders a plain (non-destructive) row above the delete row, with an outline button", async () => {
      renderWithProviders(<DangerZoneCard event={EVENT} />);

      await screen.findByRole("heading", { name: "Danger zone" });

      // The row's title text is deliberately reused verbatim as the
      // button's own label (no separate "action verb" copy exists for this
      // row) — scope this query to the <p> so it doesn't also match the
      // button below.
      expect(screen.getByText("Generate missing codes", { selector: "p" })).toBeInTheDocument();
      expect(
        screen.getByText("Backfills a code for every attendee that doesn't have one. Existing codes are never changed."),
      ).toBeInTheDocument();

      const generateButton = screen.getByRole("button", { name: "Generate missing codes" });
      // Outline, never destructive — this row's whole point is that the
      // backend call is a non-destructive backfill, so it must not carry
      // the same red-flag styling as the real delete action.
      expect(generateButton.className).toContain("border-border");
      expect(generateButton.className).not.toContain("bg-destructive");

      // DOM order: the generate row's title must appear before the delete
      // row's title, i.e. it's the row ABOVE, not below.
      const generateTitle = screen.getByText("Generate missing codes", { selector: "p" });
      const deleteTitle = screen.getByText("Delete this event");
      expect(
        generateTitle.compareDocumentPosition(deleteTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("mutates immediately on click, with no confirm dialog, and disables the button while pending", async () => {
      generateCodesDelayMs = 50;
      const user = userEvent.setup();
      renderWithProviders(<DangerZoneCard event={EVENT} />);

      const generateButton = screen.getByRole("button", { name: "Generate missing codes" });
      await user.click(generateButton);

      // No confirm dialog — this is a non-destructive backfill (spec §9).
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(generateButton).toBeDisabled();

      await waitFor(() => expect(generateCodesCount).toBe(1));
      expect(lastGenerateCodesEventId).toBe("evt-1");
      await waitFor(() => expect(generateButton).toBeEnabled());
    });

    it("shows the updated_count from the response and invalidates the attendees list on success", async () => {
      generateCodesUpdatedCount = 7;
      const user = userEvent.setup();
      renderWithProviders(<DangerZoneCard event={EVENT} />);
      await waitFor(() => expect(attendeesListHitCount).toBe(1));

      await user.click(screen.getByRole("button", { name: "Generate missing codes" }));

      expect(await screen.findByText("7 codes generated")).toBeInTheDocument();
      await waitFor(() => expect(attendeesListHitCount).toBeGreaterThan(1));
    });

    it("renders a zero count honestly, with no fake success embellishment", async () => {
      generateCodesUpdatedCount = 0;
      const user = userEvent.setup();
      renderWithProviders(<DangerZoneCard event={EVENT} />);

      await user.click(screen.getByRole("button", { name: "Generate missing codes" }));

      expect(await screen.findByText("0 codes generated")).toBeInTheDocument();
    });

    it("shows an inline error on failure, without touching the attendees list", async () => {
      generateCodesStatusOverride = 500;
      const user = userEvent.setup();
      renderWithProviders(<DangerZoneCard event={EVENT} />);
      await waitFor(() => expect(attendeesListHitCount).toBe(1));

      await user.click(screen.getByRole("button", { name: "Generate missing codes" }));

      expect(await screen.findByText("Couldn't generate codes. Please try again.")).toBeInTheDocument();
      expect(screen.queryByText(/codes generated/)).not.toBeInTheDocument();
      // A failed backfill invalidates nothing — the attendees list query
      // must not have been asked to refetch.
      expect(attendeesListHitCount).toBe(1);
    });

    it("replaces the previous result line on a re-run, rather than stacking both", async () => {
      generateCodesStatusOverride = 500;
      const user = userEvent.setup();
      renderWithProviders(<DangerZoneCard event={EVENT} />);

      const generateButton = screen.getByRole("button", { name: "Generate missing codes" });
      await user.click(generateButton);
      expect(await screen.findByText("Couldn't generate codes. Please try again.")).toBeInTheDocument();

      generateCodesStatusOverride = null;
      generateCodesUpdatedCount = 4;
      await user.click(generateButton);

      expect(await screen.findByText("4 codes generated")).toBeInTheDocument();
      expect(screen.queryByText("Couldn't generate codes. Please try again.")).not.toBeInTheDocument();
    });
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
