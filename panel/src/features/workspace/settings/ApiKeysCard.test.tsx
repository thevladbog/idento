import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { ApiKeysCard } from "./ApiKeysCard";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";
import type { components } from "../../../shared/api/schema";

type APIKey = components["schemas"]["APIKey"];

const ACTIVE: APIKey = {
  id: "key-1",
  event_id: "evt-1",
  name: "CRM sync",
  key_preview: "idnt_live_a1b2c3d4...",
  last_used_at: "2026-06-10T09:15:00.000Z",
  created_at: "2026-06-01T12:00:00.000Z",
};

const REVOKED: APIKey = {
  id: "key-2",
  event_id: "evt-1",
  name: "Old integration",
  key_preview: "idnt_live_zzzz9999...",
  revoked_at: "2026-06-15T00:00:00.000Z",
  created_at: "2026-05-01T00:00:00.000Z",
};

let keys: APIKey[] = [ACTIVE, REVOKED];
let listHitCount = 0;
let deleteCount = 0;
let lastDeletedKeyId: string | undefined;
let deleteStatusOverride: number | null = null;
let deleteDelayMs = 0;
let createCount = 0;
let lastCreateBody: unknown;
let createStatusOverride: number | null = null;
let createDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/api-keys", () => {
    listHitCount += 1;
    return HttpResponse.json(keys);
  }),
  http.post("http://api.test/api/events/:eventId/api-keys", async ({ request }) => {
    createCount += 1;
    lastCreateBody = await request.json();
    if (createDelayMs) await delay(createDelayMs);
    if (createStatusOverride) {
      return HttpResponse.json({ error: "bad request" }, { status: createStatusOverride });
    }
    const created: APIKey = {
      id: "key-new",
      event_id: "evt-1",
      name: (lastCreateBody as { name?: string }).name ?? "",
      key_preview: "idnt_live_newnewnew...",
      created_at: "2026-06-20T00:00:00.000Z",
    };
    keys = [...keys, created];
    return HttpResponse.json({ api_key: created, plain_key: "idnt_live_newnewnewSECRETVALUE" }, { status: 201 });
  }),
  http.delete("http://api.test/api/events/:eventId/api-keys/:keyId", async ({ params }) => {
    deleteCount += 1;
    lastDeletedKeyId = params.keyId as string;
    if (deleteDelayMs) await delay(deleteDelayMs);
    if (deleteStatusOverride) {
      return HttpResponse.json({ error: "server error" }, { status: deleteStatusOverride });
    }
    keys = keys.map((k) => (k.id === params.keyId ? { ...k, revoked_at: "2026-06-21T00:00:00.000Z" } : k));
    return HttpResponse.json({ message: "revoked" });
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ApiKeysCard", () => {
  beforeEach(() => {
    keys = [ACTIVE, REVOKED];
    listHitCount = 0;
    deleteCount = 0;
    lastDeletedKeyId = undefined;
    deleteStatusOverride = null;
    deleteDelayMs = 0;
    createCount = 0;
    lastCreateBody = undefined;
    createStatusOverride = null;
    createDelayMs = 0;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  // jsdom itself has no Clipboard implementation, but `userEvent.setup()`
  // (called per-test, after this helper must run) auto-attaches its own
  // getter-only clipboard stub to `navigator` (real jsdom has none; the
  // stub is testing-library's) — a mock installed before `setup()` is
  // clobbered by it, so this must be called AFTER `userEvent.setup()`, and
  // must use `defineProperty` (assignment throws on a getter-only property).
  function mockClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  it("renders a header row with Name / Created / Last used column labels above the list", async () => {
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");

    const nameHeader = screen.getByText("Name");
    const createdHeader = screen.getByText("Created");
    const lastUsedHeader = screen.getByText("Last used");
    const headerRow = nameHeader.closest("div");
    expect(headerRow).not.toBeNull();
    expect(within(headerRow as HTMLElement).getByText("Created")).toBe(createdHeader);
    expect(within(headerRow as HTMLElement).getByText("Last used")).toBe(lastUsedHeader);
  });

  it("renders keys with name, masked key preview, created/last-used dates, and a dimmed revoked row with a Revoked pill", async () => {
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    expect(await screen.findByText("CRM sync")).toBeInTheDocument();
    expect(screen.getByText("idnt_live_a1b2c3d4...")).toBeInTheDocument();
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("2026-06-10")).toBeInTheDocument();

    // Revoked row: name still shown, dimmed, "Revoked" pill instead of a
    // revoke action, em-dash for the never-set last-used date.
    const revokedRow = screen.getByText("Old integration").closest("li");
    expect(revokedRow).not.toBeNull();
    expect(revokedRow?.className).toContain("opacity");
    expect(within(revokedRow as HTMLElement).getByText("Revoked")).toBeInTheDocument();
    expect(within(revokedRow as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(within(revokedRow as HTMLElement).queryByRole("button", { name: "Revoke…" })).not.toBeInTheDocument();

    // Active row still offers Revoke…
    const activeRow = screen.getByText("CRM sync").closest("li");
    expect(within(activeRow as HTMLElement).getByRole("button", { name: "Revoke…" })).toBeInTheDocument();
  });

  it("shows a muted empty-state caption when there are no keys", async () => {
    keys = [];
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    expect(
      await screen.findByText("No API keys yet — create one to push attendees from your registration forms or CRM."),
    ).toBeInTheDocument();
  });

  it("revokes a key: confirm dialog -> DELETE -> list invalidated", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    const initialHits = listHitCount;

    const activeRow = screen.getByText("CRM sync").closest("li") as HTMLElement;
    await user.click(within(activeRow).getByRole("button", { name: "Revoke…" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Integrations using this key stop working immediately\./)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    expect(lastDeletedKeyId).toBe("key-1");
    await waitFor(() => expect(listHitCount).toBeGreaterThan(initialHits));
  });

  it("creates a key: POST with the entered name -> reveal shows the plain key once, with a copy button and warning", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    await user.click(screen.getByRole("button", { name: "+ Create key" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Registration form");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));

    await waitFor(() => expect(createCount).toBe(1));
    expect(lastCreateBody).toEqual({ name: "Registration form" });

    expect(await within(dialog).findByText("idnt_live_newnewnewSECRETVALUE")).toBeInTheDocument();
    expect(within(dialog).getByText("This is the only time the key is shown.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument();

    // list refetched after create too
    await waitFor(() => expect(screen.getAllByText(/CRM sync|Registration form/)).toHaveLength(2));
  });

  it("copies the revealed plain key to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));

    await within(dialog).findByText("idnt_live_newnewnewSECRETVALUE");
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("idnt_live_newnewnewSECRETVALUE");
  });

  it("does not show 'Copied' when the clipboard write is rejected (e.g. permission blocked)", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));

    await within(dialog).findByText("idnt_live_newnewnewSECRETVALUE");
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("idnt_live_newnewnewSECRETVALUE");
    // Give the rejected promise's handler a tick to run, then assert the
    // button never flipped to "Copied" — a failed write must not lie about
    // success.
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(within(dialog).queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("clears the plain key and resets the create mutation when the dialog is closed in reveal state, so reopening shows a fresh form", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));
    await within(dialog).findByText("idnt_live_newnewnewSECRETVALUE");

    // Close while still in the reveal state (Done button acts as close).
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen: must be a fresh create form, not stale reveal content.
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("idnt_live_newnewnewSECRETVALUE")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "+ Create key" })).toBeInTheDocument();
  });

  it("resets a stale create error on close/reopen, not just the reveal state", async () => {
    createStatusOverride = 400;
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));

    expect(await within(dialog).findByText("Couldn't create the key.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Couldn't create the key.")).not.toBeInTheDocument();
  });

  // Regression test for the close-during-pending race: the create POST is
  // still in flight when the user closes the dialog (Cancel here, but X /
  // Escape / overlay all funnel through the same setCreateOpen(false)).
  // `createKey.reset()` on close only detaches the mutation observer — it
  // does not cancel the in-flight request or stop `onSuccess` from firing
  // once the response lands late. Pre-fix, that late `onSuccess` still sets
  // `plainKey`, and reopening the dialog then shows that stray, unlabeled
  // secret directly in the reveal state instead of a fresh form.
  it("never resurfaces a stray plain_key if the create dialog is closed before the POST resolves (close-during-pending race)", async () => {
    createDelayMs = 50;
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Race key");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));

    // Close (Cancel) while the delayed POST is still in flight.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Let the delayed response land well after the close.
    await waitFor(() => expect(createCount).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, createDelayMs + 100));

    // Reopen: must be a genuinely fresh create form — the stray secret from
    // the aborted attempt above must never surface, labeled or not.
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("idnt_live_newnewnewSECRETVALUE")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "+ Create key" })).toBeInTheDocument();
  });

  // Regression test for the SECOND cancel-then-reopen race: a plain boolean
  // ref reset to false on every reopen can't tell "a response from THIS
  // session" apart from "a response from a PREVIOUSLY-closed session" once
  // the dialog has been reopened at least once — the second, still-pending
  // create's stale sibling from the first (already-cancelled) attempt can
  // land after the reopen and slip past a re-armed boolean guard. A
  // monotonically-incrementing session id (bumped on every close) closes
  // that gap: the first request's captured session id can never match the
  // current one again, no matter how many times the dialog reopens.
  it("never shows a stale plain_key from a FIRST cancelled create, even after a second create is submitted following a reopen", async () => {
    // Distinguish the two requests' responses by name-derived secret, and
    // have the FIRST (already-cancelled) request resolve well AFTER the
    // second (current) one — the exact race this fix targets: a stale
    // response from a previously-closed session landing after a reopen and
    // a fresh submit.
    let callIndex = 0;
    server.use(
      http.post("http://api.test/api/events/:eventId/api-keys", async ({ request }) => {
        callIndex += 1;
        const index = callIndex;
        const body = (await request.json()) as { name?: string };
        createCount += 1;
        lastCreateBody = body;
        await delay(index === 1 ? 150 : 20);
        const secret = index === 1 ? "SECRET_FIRST_ABORTED" : "SECRET_SECOND_CURRENT";
        const created: APIKey = {
          id: `key-${index}`,
          event_id: "evt-1",
          name: body.name ?? "",
          key_preview: "idnt_live_xxxx...",
          created_at: "2026-06-20T00:00:00.000Z",
        };
        keys = [...keys, created];
        return HttpResponse.json({ api_key: created, plain_key: secret }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");

    // First attempt: open, submit, cancel while still pending.
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "First (aborted)");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen and submit a second, current create — before the first
    // request's delayed response has landed.
    await user.click(screen.getByRole("button", { name: "+ Create key" }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Second (current)");
    await user.click(within(dialog).getByRole("button", { name: "+ Create key" }));

    // The second (current) request resolves first — its secret must appear.
    expect(await within(dialog).findByText("SECRET_SECOND_CURRENT")).toBeInTheDocument();

    // Now let the first (already-cancelled) request's late response land too.
    await waitFor(() => expect(createCount).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The stale first response must never surface — the dialog must still
    // show only the second (current) request's secret.
    expect(within(dialog).queryByText("SECRET_FIRST_ABORTED")).not.toBeInTheDocument();
    expect(within(dialog).getByText("SECRET_SECOND_CURRENT")).toBeInTheDocument();
  });

  it("shows an inline error when revoking fails, and clears it on a subsequent successful revoke", async () => {
    deleteStatusOverride = 500;
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    const activeRow = screen.getByText("CRM sync").closest("li") as HTMLElement;
    await user.click(within(activeRow).getByRole("button", { name: "Revoke…" }));

    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Couldn't revoke the key. Try again.")).toBeInTheDocument();
    // The key is still active — the failed DELETE must not be reflected as
    // if it succeeded.
    expect(within(activeRow).getByRole("button", { name: "Revoke…" })).toBeInTheDocument();

    // A subsequent successful revoke clears the stale error.
    deleteStatusOverride = null;
    await user.click(within(activeRow).getByRole("button", { name: "Revoke…" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(deleteCount).toBe(2));
    await waitFor(() => expect(screen.queryByText("Couldn't revoke the key. Try again.")).not.toBeInTheDocument());
  });

  it("disables the ConfirmDialog's confirm button while the revoke request is pending, to prevent a double DELETE", async () => {
    deleteDelayMs = 50;
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysCard eventId="evt-1" />);

    await screen.findByText("CRM sync");
    const activeRow = screen.getByText("CRM sync").closest("li") as HTMLElement;
    await user.click(within(activeRow).getByRole("button", { name: "Revoke…" }));

    const dialog = await screen.findByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Revoke" });
    await user.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    await waitFor(() => expect(deleteCount).toBe(1));
  });
});
