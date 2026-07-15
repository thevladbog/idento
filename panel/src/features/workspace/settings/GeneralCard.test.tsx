import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { GeneralCard } from "./GeneralCard";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";
import type { components } from "../../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

const BASE_EVENT: ApiEvent = {
  id: "evt-1",
  tenant_id: "t1",
  name: "Partner Day — Autumn",
  start_date: "2026-09-03T00:00:00.000Z",
  end_date: "2026-09-05T00:00:00.000Z",
  location: "Hyatt Regency",
  created_at: "",
  updated_at: "",
};

let patchCount = 0;
let lastPatchBody: unknown;
let patchResponseOverride: unknown = null;

const server = startMswServer(
  http.patch("http://api.test/api/events/:id", async ({ request }) => {
    patchCount += 1;
    lastPatchBody = await request.json();
    return HttpResponse.json(
      patchResponseOverride ?? { ...BASE_EVENT, ...(lastPatchBody as object) },
    );
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("GeneralCard", () => {
  beforeEach(() => {
    patchCount = 0;
    lastPatchBody = undefined;
    patchResponseOverride = null;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("loads the event's current values into the fields", () => {
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    expect(screen.getByLabelText("Event name")).toHaveValue("Partner Day — Autumn");
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-09-03");
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-09-05");
    expect(screen.getByLabelText("Location")).toHaveValue("Hyatt Regency");
  });

  it("keeps Save disabled until a field is dirty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.type(screen.getByLabelText("Location"), "!");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("PATCHes only the changed field and shows the saved caption", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "Marriott");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCount).toBe(1));
    expect(lastPatchBody).toEqual({ location: "Marriott" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("sends an explicit empty string to clear the location field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    await user.clear(screen.getByLabelText("Location"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCount).toBe(1));
    expect(lastPatchBody).toEqual({ location: "" });
  });

  it("converts a changed date to an ISO string and omits unchanged fields", async () => {
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCount).toBe(1));
    expect(lastPatchBody).toEqual({ end_date: new Date("2026-09-10").toISOString() });
  });

  it("shows a localized required-name error and does not call the API when the name is cleared", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    await user.clear(screen.getByLabelText("Event name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Give the event a name.")).toBeInTheDocument();
    expect(patchCount).toBe(0);
  });

  it("shows a dates-order error and does not call the API when Ends precedes Starts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-09-01" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("End date can't be before the start date.")).toBeInTheDocument();
    expect(patchCount).toBe(0);
  });

  it("disables Save and shows a muted note instead of PATCHing when a previously-set date is cleared", () => {
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Clearing a date isn't supported yet.")).toBeInTheDocument();
    expect(patchCount).toBe(0);
  });

  it("re-enables Save once a cleared date is restored", () => {
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-03" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // back to baseline, no longer dirty
    expect(screen.queryByText("Clearing a date isn't supported yet.")).not.toBeInTheDocument();
  });

  // Regression test for the Critical stale-PATCH-response race: `reset()` on
  // every keystroke only clears the mutation observer's local state — it
  // does NOT cancel the in-flight PATCH or stop `onSuccess` from firing when
  // a stale response lands late. Save being disabled during `isPending`
  // doesn't stop further typing, so the user can make a second, newer edit
  // before the first save's response arrives; that first response must not
  // silently overwrite the newer, still-unsaved edit.
  it("does not let a stale PATCH response overwrite a newer, still-unsaved edit made while the first save was pending", async () => {
    let releaseFirstPatch: (() => void) | undefined;
    server.use(
      http.patch("http://api.test/api/events/:id", async ({ request }) => {
        patchCount += 1;
        lastPatchBody = await request.json();
        // Hold this response open until the test explicitly releases it, so
        // the test controls exactly when the stale PATCH resolves relative
        // to the second, newer edit below.
        await new Promise<void>((resolve) => {
          releaseFirstPatch = resolve;
        });
        return HttpResponse.json({ ...BASE_EVENT, ...(lastPatchBody as object) });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "First edit");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCount).toBe(1));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // A legitimate second edit while the first save is still pending.
    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "Second edit");

    // Now let the first (stale) PATCH's response land.
    releaseFirstPatch?.();

    // Give the stale onSuccess a chance to run (it must not apply), then
    // assert the newer, still-unsaved edit is untouched.
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Location")).toHaveValue("Second edit");
  });

  it("surfaces a server error on failed save and clears it once the user edits again", async () => {
    server.use(
      http.patch("http://api.test/api/events/:id", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<GeneralCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("Location"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Couldn't save your changes. Please try again.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Location"), "!");
    expect(screen.queryByText("Couldn't save your changes. Please try again.")).not.toBeInTheDocument();
  });
});
