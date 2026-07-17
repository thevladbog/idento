// P3.2 Task 5 -- ZplPreviewModal tests (jsdom-viable set per the task brief).
//
// jsdom has neither a canvas 2D context (no `canvas` npm package installed --
// `getContext("2d")` returns `null`) nor the CSS Font Loading API's
// `FontFace` constructor. Both facts shape this file's fixtures:
//  - A Latin-only doc never needs image rendering (generateZpl.ts's
//    `needsImageRendering`), so it generates successfully even under jsdom
//    -- this is the "exact string" happy path.
//  - A Cyrillic doc DOES need image rendering, which routes through
//    canvasRasterizer.ts's real (unmocked) `rasterizeText` -- jsdom's null
//    2D context makes it throw `RasterUnavailableError` for real, giving an
//    honest, test-pinned degraded path instead of a silently empty tab.
//  - `useEventFontFaces` treats a missing `FontFace` constructor as a
//    documented idle state (see that hook's own module comment) -- every
//    test here stubs a minimal `FontFace`/`document.fonts` (same pattern as
//    useEventFontFaces.test.tsx) so `status` can actually reach "ready" (or
//    "error"), which is what lets generation start at all.
//
// Multi-line <pre> content is asserted via its `data-testid` + raw
// `.textContent` (never RTL's `getByText` for the full string): RTL's
// default text normalizer collapses embedded newlines to single spaces
// before matching, which would make an exact multi-line ZPL string never
// match itself.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ZplPreviewModal, type ZplPreviewModalProps } from "./ZplPreviewModal";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

const CONFIG = { width_mm: 90, height_mm: 55, dpi: 300 };

// Matches generateZpl.test.ts's own "plain (no-width) field" golden case
// exactly, so this exact-string expectation is trustworthy without
// re-deriving the dot math by hand here.
const LATIN_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, text: "Hi" }],
};
const LATIN_EXPECTED_ZPL = "^XA\n^CI28\n^PW1063\n^LL650\n^PR4\n^LH0,0\n^FO0,0^A0N,42,42^FDHi^FS\n^XZ\n";

const CYRILLIC_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, text: "Привет" }],
};

const SOURCE_BOUND_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
};

function fontListItem(id: string, family: string) {
  return {
    id, name: family, family, weight: "normal", style: "normal", format: "opentype" as const, size: 1000,
    created_at: "2026-01-01T00:00:00Z",
  };
}

let fontsResponse: unknown[] = [];
let failFamilies: Set<string>;

class MockFontFace {
  family: string;
  constructor(family: string, _source: unknown, _descriptors?: { weight?: string; style?: string }) {
    this.family = family;
  }
  load(): Promise<MockFontFace> {
    if (failFamilies.has(this.family)) return Promise.reject(new Error(`mock load failure for ${this.family}`));
    return Promise.resolve(this);
  }
}

function stubFontFaceApi() {
  failFamilies = new Set();
  (globalThis as unknown as { FontFace: unknown }).FontFace = MockFontFace;
  Object.defineProperty(document, "fonts", {
    value: { add: () => {} },
    configurable: true,
    writable: true,
  });
}

function unstubFontFaceApi() {
  delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
  // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts`
  // stub; real jsdom has no `fonts` property to restore.
  delete document.fonts;
}

const FAKE_FONT_BYTES = new TextEncoder().encode("fake-font-bytes").buffer as ArrayBuffer;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json(fontsResponse)),
  http.get("http://api.test/api/fonts/:id/file", () => HttpResponse.arrayBuffer(FAKE_FONT_BYTES)),
);
void server;

function renderModal(overrides: Partial<ZplPreviewModalProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const props: ZplPreviewModalProps = {
    open: true,
    onOpenChange,
    doc: LATIN_DOC,
    config: CONFIG,
    previewData: {},
    previewName: "Anna Petrova",
    eventId: "evt-1",
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={qc}>
      <ZplPreviewModal {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange, qc, props };
}

// Waits for (and returns) the ZPL tab's `<pre>` once generation resolves --
// present only while the ZPL tab is active AND generation succeeded.
async function findGeneratedPre() {
  return waitFor(() => {
    const pre = screen.getByTestId("badge-zpl-preview-code");
    if (!pre.textContent || !pre.textContent.startsWith("^XA")) throw new Error("not generated yet");
    return pre;
  });
}

describe("ZplPreviewModal", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    fontsResponse = [];
    stubFontFaceApi();
  });

  afterEach(() => {
    unstubFontFaceApi();
    // Restore jsdom's default clipboard-less `navigator` so the
    // Object.defineProperty stubs the copy tests install never leak into
    // later tests/files (each userEvent.setup() call re-installs its own
    // stub anyway; this removes OURS). Defined `configurable: true` above,
    // so a plain delete is enough -- and a no-op when a test never stubbed.
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  it("shows the exact generated ZPL for a Latin-only doc (native text path, no canvas needed)", async () => {
    renderModal();

    const pre = await findGeneratedPre();
    expect(pre.textContent).toBe(LATIN_EXPECTED_ZPL);
  });

  it("shows an in-modal error line for a Cyrillic doc instead of a silently empty tab (jsdom has no canvas)", async () => {
    renderModal({ doc: CYRILLIC_DOC });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This badge needs image rendering for Cyrillic or custom-font text, and this browser's canvas isn't available.",
    );
    expect(screen.queryByTestId("badge-zpl-preview-code")).not.toBeInTheDocument();
  });

  it("copies the generated ZPL to the clipboard and shows the success state", async () => {
    const user = userEvent.setup();
    renderModal();
    await findGeneratedPre();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(LATIN_EXPECTED_ZPL);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("does not show 'Copied' when the clipboard write is rejected", async () => {
    const user = userEvent.setup();
    renderModal();
    await findGeneratedPre();

    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("the segmented toggle switches between the ZPL and Rendered panes, reflecting the active tab via aria-pressed", async () => {
    const user = userEvent.setup();
    renderModal();
    await findGeneratedPre();

    const zplTabButton = screen.getByRole("button", { name: "ZPL code" });
    const renderedTabButton = screen.getByRole("button", { name: "Rendered" });
    expect(zplTabButton).toHaveAttribute("aria-pressed", "true");
    expect(renderedTabButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("badge-zpl-preview-code")).toBeInTheDocument();

    await user.click(renderedTabButton);

    expect(zplTabButton).toHaveAttribute("aria-pressed", "false");
    expect(renderedTabButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("badge-zpl-preview-code")).not.toBeInTheDocument();
    // jsdom has no canvas 2D context regardless of doc content -- the
    // Rendered tab's own guard always falls back to this message here.
    expect(screen.getByText("The rendered preview isn't available in this browser.")).toBeInTheDocument();
  });

  it("regenerates when the previewed attendee's data changes, reflecting the new name", async () => {
    const { rerender, qc } = renderModal({ doc: SOURCE_BOUND_DOC, previewData: { first_name: "Anna" } });
    await waitFor(() => expect(screen.getByTestId("badge-zpl-preview-code").textContent).toContain("^FDAnna^FS"));

    rerender(
      <QueryClientProvider client={qc}>
        <ZplPreviewModal
          open
          onOpenChange={() => {}}
          doc={SOURCE_BOUND_DOC}
          config={CONFIG}
          previewData={{ first_name: "Max" }}
          previewName="Max Muster"
          eventId="evt-1"
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("badge-zpl-preview-code").textContent).toContain("^FDMax^FS"));
    expect(screen.getByTestId("badge-zpl-preview-code").textContent).not.toContain("FDAnna");
  });

  it("shows a visible fonts-not-ready warning (and still generates) when the event's fonts fail to load", async () => {
    fontsResponse = [fontListItem("f1", "BrokenFont")];
    failFamilies = new Set(["BrokenFont"]);
    renderModal();

    expect(await screen.findByText(
      "Some event fonts failed to load — this preview may use fallback glyphs.",
    )).toBeInTheDocument();
    await findGeneratedPre();
  });

  // Task 5 review Important 3: the fonts-LIST fetch failing (not just an
  // individual font's load) used to leave useEventFontFaces on "idle"
  // forever, which wedged this modal on its "Generating…" placeholder --
  // generation only unblocks on a terminal fonts status. The hook now maps
  // a failed list query to "error" (useEventFontFaces.test.tsx pins that
  // transition itself); this pins the MODAL's behavior on top of it: warn
  // visibly, then still generate (native-only path here -- Latin doc).
  it("shows the fonts warning and still generates when the fonts LIST fetch itself fails (never a permanent Generating state)", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/fonts", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderModal();

    expect(await screen.findByText(
      "Some event fonts failed to load — this preview may use fallback glyphs.",
    )).toBeInTheDocument();
    const pre = await findGeneratedPre();
    expect(pre.textContent).toBe(LATIN_EXPECTED_ZPL);
  });

  // PR #74 review round Fix 8: unlike the drawer/bulk/test-print SEND
  // surfaces (which must hard-block on a missing customFont — see
  // usePrintBadge.ts's MissingFontError), the PREVIEW modal only WARNS —
  // it's on-screen review, not a physical print, so rendering a fallback
  // glyph here is honest enough. This is a NEW, more specific warning than
  // the generic `badgeFontsNotReady` line above (that one covers a fonts-
  // LIST/individual-font LOAD failure; this one covers a customFont that
  // was never even uploaded for this event in the first place).
  it("shows a missing-custom-font warning (without blocking the preview) when a text element references a customFont with no matching uploaded font", async () => {
    const docWithMissingFont = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, text: "Hi", customFont: "Brand Sans" }],
    };
    renderModal({ doc: docWithMissingFont });

    expect(await screen.findByText(
      "Font Brand Sans is missing — this preview may use fallback glyphs.",
    )).toBeInTheDocument();
    // A WARNING, never a block: the dialog stays fully usable (both view-
    // toggle buttons present) -- contrast with MissingFontError's hard
    // block on the drawer/bulk/test-print surfaces, which never even reach
    // generation.
    expect(screen.getByRole("button", { name: "ZPL code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rendered" })).toBeInTheDocument();
  });
});
