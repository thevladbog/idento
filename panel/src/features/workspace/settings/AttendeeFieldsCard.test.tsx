import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { AttendeeFieldsCard } from "./AttendeeFieldsCard";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";
import type { components } from "../../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

const BASE_EVENT: ApiEvent = {
  id: "evt-1",
  tenant_id: "t1",
  name: "Partner Day — Autumn",
  field_schema: ["Diet", "T-shirt size"],
  created_at: "",
  updated_at: "",
};

// Deliberately a separate literal (not a destructure-and-omit of BASE_EVENT)
// so there's no unused `field_schema` binding to suppress.
const EVENT_NO_FIELDS: ApiEvent = {
  id: "evt-2",
  tenant_id: "t1",
  name: "No Fields Event",
  created_at: "",
  updated_at: "",
};

let patchCount = 0;
let lastPatchBody: unknown;

const server = startMswServer(
  http.patch("http://api.test/api/events/:id", async ({ request }) => {
    patchCount += 1;
    lastPatchBody = await request.json();
    return HttpResponse.json({ ...BASE_EVENT, ...(lastPatchBody as object) });
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("AttendeeFieldsCard", () => {
  beforeEach(() => {
    patchCount = 0;
    lastPatchBody = undefined;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("lists the event's current field_schema entries", () => {
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    expect(screen.getByDisplayValue("Diet")).toBeInTheDocument();
    expect(screen.getByDisplayValue("T-shirt size")).toBeInTheDocument();
  });

  it("shows the empty-state copy, not a fabricated field list, when field_schema is an empty array", () => {
    renderWithProviders(<AttendeeFieldsCard event={{ ...BASE_EVENT, field_schema: [] }} />);

    expect(screen.getByText("No custom attendee fields yet.")).toBeInTheDocument();
  });

  it("shows the empty-state copy when field_schema is undefined", () => {
    renderWithProviders(<AttendeeFieldsCard event={EVENT_NO_FIELDS} />);

    expect(screen.getByText("No custom attendee fields yet.")).toBeInTheDocument();
  });

  it("always shows the removal note, regardless of whether anything has been removed", () => {
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    expect(
      screen.getByText("Removing a field never deletes values already stored on attendees."),
    ).toBeInTheDocument();
  });

  it("keeps Save disabled until a field is added, renamed, or removed", () => {
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("adds a new field locally without PATCHing until Save is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("New field name"), "Allergies");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(screen.getByDisplayValue("Allergies")).toBeInTheDocument();
    expect(patchCount).toBe(0);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("clears the add-field input after adding, so the same input can't be added twice by accident", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("New field name"), "Allergies");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(screen.getByLabelText("New field name")).toHaveValue("");
  });

  it("renames a field inline", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    const dietInput = screen.getByDisplayValue("Diet");
    await user.clear(dietInput);
    await user.type(dietInput, "Dietary needs");

    expect(screen.getByDisplayValue("Dietary needs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("removes a field locally", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]);

    expect(screen.queryByDisplayValue("Diet")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("T-shirt size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("disables Save and shows a blank-name error when a field is cleared", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.clear(screen.getByDisplayValue("Diet"));

    expect(await screen.findByText("Field name can't be empty.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables Save and shows a duplicate error on BOTH rows when two fields share a name case-insensitively", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    const sizeInput = screen.getByDisplayValue("T-shirt size");
    await user.clear(sizeInput);
    await user.type(sizeInput, "DIET");

    const duplicateErrors = await screen.findAllByText("This name is already used by another field.");
    expect(duplicateErrors).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables Save and shows a reserved-name error when a field collides with a standard field, case-insensitively", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    const dietInput = screen.getByDisplayValue("Diet");
    await user.clear(dietInput);
    await user.type(dietInput, "Email");

    expect(
      await screen.findByText("This name is reserved for a standard attendee field."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("re-enables Save once the offending row is fixed (blank -> valid, back to dirty-but-valid)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    const dietInput = screen.getByDisplayValue("Diet");
    await user.clear(dietInput);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.type(dietInput, "Dietary needs");
    expect(screen.queryByText("Field name can't be empty.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("PATCHes the full field_schema array (not a partial diff) on Save", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("New field name"), "Allergies");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCount).toBe(1));
    expect(lastPatchBody).toEqual({ field_schema: ["Diet", "T-shirt size", "Allergies"] });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("resets baseline after a successful save (Save disabled again, no pending edits)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("New field name"), "Allergies");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  // Regression test for the same stale-PATCH-response race GeneralCard.test.tsx
  // covers (GeneralCard.tsx:81's editVersionRef pattern, mirrored here):
  // `reset()` on every edit only clears the mutation observer's local state —
  // it does NOT cancel the in-flight PATCH or stop `onSuccess` from firing
  // when a stale response lands late.
  it("does not let a stale PATCH response overwrite a newer, still-unsaved edit made while the first save was pending", async () => {
    let releaseFirstPatch: (() => void) | undefined;
    server.use(
      http.patch("http://api.test/api/events/:id", async ({ request }) => {
        patchCount += 1;
        lastPatchBody = await request.json();
        await new Promise<void>((resolve) => {
          releaseFirstPatch = resolve;
        });
        return HttpResponse.json({ ...BASE_EVENT, ...(lastPatchBody as object) });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("New field name"), "Allergies");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCount).toBe(1));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // A legitimate second edit while the first save is still pending.
    await user.type(screen.getByLabelText("New field name"), "Badge color");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    // Now let the first (stale) PATCH's response land.
    releaseFirstPatch?.();

    // Give the stale onSuccess a chance to run (it must not apply), then
    // assert the newer, still-unsaved edit is untouched.
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("Badge color")).toBeInTheDocument();
  });

  it("surfaces a server error on failed save and clears it once the user edits again", async () => {
    server.use(
      http.patch("http://api.test/api/events/:id", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeFieldsCard event={BASE_EVENT} />);

    await user.type(screen.getByLabelText("New field name"), "Allergies");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Couldn't save your changes. Please try again.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("New field name"), "X");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.queryByText("Couldn't save your changes. Please try again.")).not.toBeInTheDocument();
  });
});
