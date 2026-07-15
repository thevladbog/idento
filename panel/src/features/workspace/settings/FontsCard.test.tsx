import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { FontsCard } from "./FontsCard";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";
import type { components } from "../../../shared/api/schema";

// NOTE on why this file parses multipart bodies by hand instead of calling
// `await request.formData()` (which the task brief's sketch suggested):
// jsdom (this project's Vitest `environment: "jsdom"`) ships its own
// File/Blob/FormData classes, but `Request`/`fetch` here are Node's native
// (undici-backed) globals — jsdom's `Request` merely subclasses the native
// one. When a jsdom File is appended to a jsdom FormData and handed to the
// native Request as its body, undici's multipart body-builder doesn't
// recognize jsdom's Blob/File as blob-like (a cross-realm identity/webidl-
// brand mismatch), so it silently serializes the file part as an empty
// blob with a lost filename. Re-parsing that malformed body via
// `request.formData()` then throws an internal `webidl.is.File` assertion
// deep in undici. This was verified directly: constructing
// `new Request(url, { body: someJsdomFormData })` and immediately calling
// `.formData()` on it — with NO app code or MSW involved at all — already
// throws the same assertion, so it's a test-environment limitation, not a
// bug in FontsCard's bodySerializer (confirmed separately: the same
// FormData→Request→formData() round trip works perfectly under plain
// Node, outside jsdom). Reading the raw body as text and matching the
// well-known multipart wire format sidesteps the broken parser while still
// verifying the real bytes our code sent over the (mocked) network.
function readMultipartField(raw: string, field: string): string | undefined {
  const match = raw.match(new RegExp(`name="${field}"\\r\\n\\r\\n([^\\r]*)\\r`));
  return match?.[1];
}

type FontListItem = components["schemas"]["FontListItem"];

const ACME: FontListItem = {
  id: "font-1",
  name: "Acme Grotesk",
  family: "Acme Grotesk",
  weight: "normal",
  style: "normal",
  format: "woff2",
  size: 52224, // 51 KB
  created_at: "2026-06-01T12:00:00.000Z",
};

const VEKTOR: FontListItem = {
  id: "font-2",
  name: "Vektor Display",
  family: "Vektor Display",
  weight: "bold",
  style: "normal",
  format: "truetype",
  size: 2202009, // ~2.1 MB
  created_at: "2026-06-05T08:30:00.000Z",
};

let fonts: FontListItem[] = [ACME, VEKTOR];
let listHitCount = 0;
let deleteCount = 0;
let lastDeletedFontId: string | undefined;
let deleteStatusOverride: number | null = null;
let deleteDelayMs = 0;
let uploadCount = 0;
let lastUploadFields: Record<string, string | undefined> | undefined;
let uploadStatusOverride: number | null = null;
let uploadDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/fonts", () => {
    listHitCount += 1;
    return HttpResponse.json(fonts);
  }),
  http.post("http://api.test/api/events/:eventId/fonts", async ({ request }) => {
    uploadCount += 1;
    if (uploadDelayMs) await delay(uploadDelayMs);
    if (uploadStatusOverride) {
      return HttpResponse.json({ error: "bad extension" }, { status: uploadStatusOverride });
    }
    const raw = await request.text();
    lastUploadFields = {
      hasFilePart: raw.includes('name="file"') ? "true" : "false",
      name: readMultipartField(raw, "name"),
      family: readMultipartField(raw, "family"),
      license_accepted: readMultipartField(raw, "license_accepted"),
    };
    const created: FontListItem = {
      id: "font-new",
      name: lastUploadFields.name ?? "",
      family: lastUploadFields.family ?? "",
      weight: "normal",
      style: "normal",
      format: "woff2",
      size: 12345,
      created_at: "2026-06-10T00:00:00.000Z",
    };
    fonts = [...fonts, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete("http://api.test/api/events/:eventId/fonts/:fontId", async ({ params }) => {
    deleteCount += 1;
    lastDeletedFontId = params.fontId as string;
    if (deleteDelayMs) await delay(deleteDelayMs);
    if (deleteStatusOverride) {
      return HttpResponse.json({ error: "server error" }, { status: deleteStatusOverride });
    }
    fonts = fonts.filter((f) => f.id !== params.fontId);
    return HttpResponse.json({ status: "deleted" });
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeFile(name: string, sizeBytes: number, type: string) {
  const file = new File([new Uint8Array(sizeBytes)], name, { type });
  return file;
}

describe("FontsCard", () => {
  beforeEach(() => {
    fonts = [ACME, VEKTOR];
    listHitCount = 0;
    deleteCount = 0;
    lastDeletedFontId = undefined;
    deleteStatusOverride = null;
    deleteDelayMs = 0;
    uploadCount = 0;
    lastUploadFields = undefined;
    uploadStatusOverride = null;
    uploadDelayMs = 0;
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  it("renders uploaded fonts with name, UPLOADED pill, and metadata caption", async () => {
    renderWithProviders(<FontsCard eventId="evt-1" />);

    expect(await screen.findByText("Acme Grotesk")).toBeInTheDocument();
    expect(screen.getByText("Vektor Display")).toBeInTheDocument();

    const pills = screen.getAllByText("UPLOADED");
    expect(pills).toHaveLength(2);

    // format · size · UTC date
    expect(screen.getByText("woff2 · 51.0 KB · 2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("truetype · 2.1 MB · 2026-06-05")).toBeInTheDocument();
  });

  it("shows a muted empty-state caption when there are no fonts", async () => {
    fonts = [];
    renderWithProviders(<FontsCard eventId="evt-1" />);

    expect(await screen.findByText("No custom fonts yet — the badge editor uses the built-in font until you add one.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("removes a font: confirm dialog with the font name -> DELETE called -> list invalidated", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");
    const initialHits = listHitCount;

    const removeButtons = screen.getAllByRole("button", { name: "Remove…" });
    await user.click(removeButtons[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Acme Grotesk/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    expect(lastDeletedFontId).toBe("font-1");
    // list must be refetched (invalidated), not just locally mutated
    await waitFor(() => expect(listHitCount).toBeGreaterThan(initialHits));
    await waitFor(() => expect(screen.queryByText("Acme Grotesk")).not.toBeInTheDocument());
  });

  it("uploads a picked file as multipart/form-data with name/family derived from the filename and license_accepted='true'", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");

    await user.click(screen.getByRole("checkbox"));
    const file = makeFile("Roboto Bold.woff2", 12345, "font/woff2");
    const input = screen.getByLabelText("Drop a .ttf / .otf / .woff file here or") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadCount).toBe(1));
    expect(lastUploadFields?.hasFilePart).toBe("true");
    expect(lastUploadFields?.name).toBe("Roboto Bold");
    expect(lastUploadFields?.family).toBe("Roboto Bold");
    expect(lastUploadFields?.license_accepted).toBe("true");

    await waitFor(() => expect(screen.getByText("Roboto Bold")).toBeInTheDocument());
  });

  it("shows a disabled/uploading state on the drop-zone while the upload is pending", async () => {
    uploadDelayMs = 50;
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");

    await user.click(screen.getByRole("checkbox"));
    const file = makeFile("Slow.woff2", 100, "font/woff2");
    const input = screen.getByLabelText("Drop a .ttf / .otf / .woff file here or") as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText("Uploading…")).toBeInTheDocument();
    await waitFor(() => expect(uploadCount).toBe(1));
  });

  it("shows a generic i18n'd error message when the upload fails (e.g. server 400)", async () => {
    uploadStatusOverride = 400;
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");

    await user.click(screen.getByRole("checkbox"));
    // Extension must pass the input's own `accept` filter (client-side,
    // enforced by user-event) so the pick reaches our onChange handler at
    // all — the 400 here simulates a server-side rejection (e.g. the
    // 5 MB size limit) that the client can't pre-validate.
    const file = makeFile("TooBig.woff2", 100, "font/woff2");
    const input = screen.getByLabelText("Drop a .ttf / .otf / .woff file here or") as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText("Couldn't upload the font.")).toBeInTheDocument();
  });

  it("shows an inline error when removing a font fails, and clears it on a subsequent successful remove", async () => {
    deleteStatusOverride = 500;
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");

    let removeButtons = screen.getAllByRole("button", { name: "Remove…" });
    await user.click(removeButtons[0]);

    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Couldn't remove the font. Try again.")).toBeInTheDocument();
    // The font is still listed — the failed DELETE must not be reflected as
    // if it succeeded.
    expect(screen.getByText("Acme Grotesk")).toBeInTheDocument();

    // A subsequent successful remove clears the stale error.
    deleteStatusOverride = null;
    removeButtons = screen.getAllByRole("button", { name: "Remove…" });
    await user.click(removeButtons[0]);
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteCount).toBe(2));
    await waitFor(() => expect(screen.queryByText("Couldn't remove the font. Try again.")).not.toBeInTheDocument());
  });

  it("disables the ConfirmDialog's confirm button while the remove request is pending, to prevent a double DELETE", async () => {
    deleteDelayMs = 50;
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");

    const removeButtons = screen.getAllByRole("button", { name: "Remove…" });
    await user.click(removeButtons[0]);

    const dialog = await screen.findByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Remove" });
    await user.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    await waitFor(() => expect(deleteCount).toBe(1));
  });

  it("always shows the license disclaimer box near the upload affordance", async () => {
    renderWithProviders(<FontsCard eventId="evt-1" />);

    expect(
      await screen.findByText(
        "You are fully responsible for font licensing. By uploading, you confirm you hold the rights to use this font for printing badges.",
      ),
    ).toBeInTheDocument();
  });

  // Fix: the "accepted" flag must actually mean something — the upload
  // affordance is unusable until the user has explicitly checked the
  // license box, not just decorative text next to an always-true flag.
  it("disables the upload input until the license checkbox is checked, and enables it once checked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FontsCard eventId="evt-1" />);

    await screen.findByText("Acme Grotesk");

    const checkbox = screen.getByRole("checkbox");
    const input = screen.getByLabelText("Drop a .ttf / .otf / .woff file here or") as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
    expect(input).toBeDisabled();

    // Uploading while unchecked must not reach the server at all — user-event
    // itself refuses to fire onChange on a disabled input.
    const file = makeFile("Blocked.woff2", 100, "font/woff2");
    await user.upload(input, file);
    expect(uploadCount).toBe(0);

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(input).toBeEnabled();

    await user.upload(input, file);
    await waitFor(() => expect(uploadCount).toBe(1));
  });
});
