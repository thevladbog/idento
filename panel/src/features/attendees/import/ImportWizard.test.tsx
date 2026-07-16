import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { ImportWizard } from "./ImportWizard";
import { decodeBuffer } from "./encoding";
import { parseCsv } from "./parseCsv";
import * as parseCsvModule from "./parseCsv";
import { ATTENDEES_LIST_KEY } from "../hooks";
import { useEventReadiness } from "../../events/hooks";
import { startMswServer } from "../../../test/msw";
import "../../../shared/i18n";

// Task 13 adds a $api.useMutation call (the bulk-import POST), which throws
// without a QueryClient ancestor even for steps 1-2 that never fire it (the
// hook itself calls useQueryClient() unconditionally on every render). Every
// render call in this file goes through this helper from here on, matching
// AddAttendeeDialog.test.tsx's established pattern. Using RTL's `wrapper`
// option (not manually wrapping the JSX) means `rerender` — used by the
// close/reopen test below — keeps applying the same provider automatically.
function renderWizard(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { queryClient, ...render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  }) };
}

beforeEach(() => {
  window.__ENV__ = { API_URL: "http://api.test" };
});

// Moved up from its original spot (right before the step-3 chunked-import
// tests) so the Fix 2 busy-gating tests below can share it too — a
// resolve()-able gate for deterministically controlling when a mocked async
// operation (a fetch mock, or here a File.prototype.arrayBuffer override)
// settles.
function createGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Same windows-1251 byte mapping as encoding.test.ts (Task 10), verified
// against the WHATWG windows-1251 index and cross-checked below by
// round-tripping through the REAL `TextDecoder("windows-1251")` before it's
// used as a fixture: uppercase А-Я (U+0410-U+042F) -> 0xC0-0xDF, lowercase
// а-я (U+0430-U+044F) -> 0xE0-0xFF, Ё (U+0401) -> 0xA8, ё (U+0451) -> 0xB8,
// ASCII passes through unchanged (covers the comma/newline delimiters).
function toWindows1251Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code === 0x401) {
      bytes.push(0xa8);
    } else if (code === 0x451) {
      bytes.push(0xb8);
    } else if (code >= 0x410 && code <= 0x42f) {
      bytes.push(0xc0 + (code - 0x410));
    } else if (code >= 0x430 && code <= 0x44f) {
      bytes.push(0xe0 + (code - 0x430));
    } else {
      throw new Error(`Unsupported test-fixture character: ${ch} (U+${code.toString(16)})`);
    }
  }
  return new Uint8Array(bytes);
}

const CSV_TEXT = "Имя,Компания\nАнна,Ромашка\nОлег,Вектор\nМария,Старт\n";
const EXPECTED_CORRECT_CELLS = ["Анна", "Ромашка", "Олег", "Вектор", "Мария", "Старт"];

function buildWin1251File(name = "участники.csv"): File {
  return new File([toWindows1251Bytes(CSV_TEXT)], name, { type: "text/csv" });
}

async function previewCellTexts() {
  const table = await screen.findByRole("table");
  return within(table).getAllByRole("cell").map((cell) => cell.textContent);
}

describe("ImportWizard fixture sanity", () => {
  // This isn't testing ImportWizard itself — it's proving the hand-built
  // byte mapping above genuinely round-trips through the real windows-1251
  // decoder before it's trusted as a "real windows-1251 file" fixture,
  // exactly the kind of independent check Task 10's own tests used.
  it("the windows-1251 fixture bytes decode back to the original Cyrillic text", () => {
    const bytes = toWindows1251Bytes(CSV_TEXT);
    expect(new TextDecoder("windows-1251").decode(bytes)).toBe(CSV_TEXT);
  });
});

describe("ImportWizard", () => {
  it("shows step 1 as current and steps 2/3 as future before any file is picked", () => {
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");
    expect(screen.getByTestId("import-step-2")).toHaveAttribute("data-step-status", "future");
    expect(screen.getByTestId("import-step-3")).toHaveAttribute("data-step-status", "future");
  });

  it("auto-detects windows-1251 for a real windows-1251 file and shows a correctly decoded preview", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);

    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());

    expect(await screen.findByText("Auto-detected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Windows-1251" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "UTF-8" })).toHaveAttribute("aria-pressed", "false");

    await waitFor(async () => {
      expect(await previewCellTexts()).toEqual(EXPECTED_CORRECT_CELLS);
    });

    // File chip shows name + size, no row count (a preview-only 3-row parse
    // can't cheaply know the full file's row count without a second pass).
    expect(screen.getByText("участники.csv")).toBeInTheDocument();
    expect(screen.getByText(/KB.*parsed in a worker, the UI never freezes/)).toBeInTheDocument();
  });

  it("overriding the encoding to UTF-8 hides the auto-detected badge and re-renders the preview as real mojibake", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    const file = buildWin1251File();
    await user.upload(screen.getByLabelText("Choose a CSV file"), file);
    await screen.findByText("Auto-detected");
    await waitFor(async () => {
      expect(await previewCellTexts()).toEqual(EXPECTED_CORRECT_CELLS);
    });

    // Ground truth for "mojibake", computed via the same production
    // decode/parse modules the wizard itself uses — NOT a hand-typed
    // garbled string — so this genuinely proves the bytes decode wrong
    // under UTF-8, rather than merely asserting "something changed".
    const buffer = await file.arrayBuffer();
    const mojibakeText = decodeBuffer(buffer, "utf-8");
    const expectedMojibake = await parseCsv(mojibakeText, { preview: 3, worker: false });
    const expectedMojibakeCells = expectedMojibake.rows.flatMap((row) => expectedMojibake.headers.map((h) => row[h]));
    expect(expectedMojibakeCells).not.toEqual(EXPECTED_CORRECT_CELLS);

    await user.click(screen.getByRole("button", { name: "UTF-8" }));

    expect(screen.queryByText("Auto-detected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UTF-8" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => {
      expect(await previewCellTexts()).toEqual(expectedMojibakeCells);
    });
  });

  it("keeps Continue disabled until a file is picked, then enables it", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    const continueButton = screen.getByRole("button", { name: "Continue → Columns" });
    expect(continueButton).toBeDisabled();

    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");

    expect(continueButton).toBeEnabled();
  });

  it("advances the step indicator to step 2 (with the real mapping grid) when Continue is clicked", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");

    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));

    expect(await screen.findByTestId("import-step-2")).toHaveAttribute("data-step-status", "current");
    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "done");
    expect(screen.getByTestId("import-step-3")).toHaveAttribute("data-step-status", "future");
    expect(screen.getByRole("combobox", { name: "Имя" })).toBeInTheDocument();
  });

  it("resets to step 1 with no file when closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");
    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
    expect(await screen.findByTestId("import-step-2")).toHaveAttribute("data-step-status", "current");

    rerender(<ImportWizard eventId="evt-1" open={false} onOpenChange={vi.fn()} />);
    rerender(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");
    expect(screen.queryByText("Auto-detected")).not.toBeInTheDocument();
  });
});

// Fix 2 (CodeRabbit, PR #65): step 1's file pick / encoding change / full
// parse previously had no busy-gate or stale-completion guard — a
// still-in-flight operation could resolve AFTER the dialog was closed
// (resetting `state`) and reopened, silently repopulating the "fresh"
// wizard with the previous session's data. These tests gate a real File's
// `arrayBuffer()` (used by handleFilePick, the step that matters most since
// it's the entry point) and parseCsv's full parse (handleContinue) behind a
// controllable promise to make that race deterministically reproducible.
describe("ImportWizard step 1 — busy-gating & stale-completion guard", () => {
  it("does not repopulate a freshly reset wizard when a stale file pick resolves after close+reopen", async () => {
    const user = userEvent.setup();
    const gate = createGate();
    const originalArrayBuffer = File.prototype.arrayBuffer;
    const arrayBufferSpy = vi.spyOn(File.prototype, "arrayBuffer").mockImplementation(function (this: File) {
      return gate.promise.then(() => originalArrayBuffer.call(this));
    });

    const { rerender } = renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());

    // The pick is gated mid-flight (arrayBuffer() hasn't resolved yet) —
    // close the dialog before it does, then reopen for a genuinely fresh
    // import.
    rerender(<ImportWizard eventId="evt-1" open={false} onOpenChange={vi.fn()} />);
    rerender(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByLabelText("Choose a CSV file")).toBeInTheDocument();
    expect(screen.queryByText("участники.csv")).not.toBeInTheDocument();

    // Now let the stale pick's promise chain resolve, well after the dialog
    // moved on to a fresh session.
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Still fresh — the stale resolution must NOT have repopulated it with
    // the previous session's file/preview.
    expect(screen.queryByText("участники.csv")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose a CSV file")).toBeInTheDocument();
    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");

    arrayBufferSpy.mockRestore();
  });

  it("blocks dialog dismissal (✕/Escape) and disables Cancel while a step-1 file pick is in flight, and allows both once it settles", async () => {
    const user = userEvent.setup();
    const gate = createGate();
    const originalArrayBuffer = File.prototype.arrayBuffer;
    const arrayBufferSpy = vi.spyOn(File.prototype, "arrayBuffer").mockImplementation(function (this: File) {
      return gate.promise.then(() => originalArrayBuffer.call(this));
    });
    const onOpenChange = vi.fn();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={onOpenChange} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());

    // Busy: no ✕ in the DOM at all (hideClose), Cancel disabled, Escape
    // doesn't dismiss.
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();

    gate.resolve();
    await screen.findByText("участники.csv");

    // Settled: closable again.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    arrayBufferSpy.mockRestore();
  });

  it("blocks dialog dismissal while the step 1->2 full parse is in flight, and allows it once settled", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");

    const gate = createGate();
    const realParseCsv = parseCsvModule.parseCsv;
    const parseSpy = vi.spyOn(parseCsvModule, "parseCsv").mockImplementation(async (text, opts) => {
      // Only the FULL parse (no `preview` option) is gated — the 3-row
      // preview parses used by file pick / encoding change stay real so the
      // file chip renders normally above.
      if (opts?.preview) return realParseCsv(text, opts);
      await gate.promise;
      return realParseCsv(text, opts);
    });

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));

    // Busy: no ✕, Cancel disabled.
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    gate.resolve();
    await screen.findByTestId("import-step-2");

    parseSpy.mockRestore();
  });

  // Fix (Codex, PR #65): step1SessionRef only protects against close/reopen
  // — it does nothing for two encoding clicks made in quick succession
  // within the SAME open session, where an earlier (slower) reparse could
  // otherwise resolve after a later (faster) one and silently overwrite the
  // encoding/preview the operator actually chose last. Disabling both
  // segments for the duration of a reparse closes this at the UI level: a
  // second click simply cannot fire (a disabled DOM button doesn't dispatch
  // click events) until the first reparse has settled, so this test proves
  // the actually-reachable half of the fix. encodingChangeTokenRef's
  // ordering guard (see its own doc comment in ImportWizard.tsx) is kept as
  // defense-in-depth for any future path that calls handleEncodingChange
  // without going through these disabled buttons.
  it("disables both encoding segments for the duration of a reparse, and re-enables them with the correct final state once it settles", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");
    await waitFor(async () => {
      expect(await previewCellTexts()).toEqual(EXPECTED_CORRECT_CELLS);
    });

    const gate = createGate();
    const realParseCsv = parseCsvModule.parseCsv;
    const parseSpy = vi.spyOn(parseCsvModule, "parseCsv").mockImplementation(async (text, opts) => {
      if (!opts?.preview) return realParseCsv(text, opts);
      await gate.promise;
      return realParseCsv(text, opts);
    });

    const windows1251Button = screen.getByRole("button", { name: "Windows-1251" });
    const utf8Button = screen.getByRole("button", { name: "UTF-8" });
    await user.click(utf8Button);

    // Busy: both segments disabled, including the one just clicked — a
    // second click on either is a no-op while the reparse is in flight.
    expect(utf8Button).toBeDisabled();
    expect(windows1251Button).toBeDisabled();
    await user.click(windows1251Button);
    // Still showing the PRE-click (windows-1251) preview — the disabled
    // click above must not have started a second reparse.
    expect(await previewCellTexts()).toEqual(EXPECTED_CORRECT_CELLS);

    gate.resolve();
    await waitFor(() => expect(utf8Button).toHaveAttribute("aria-pressed", "true"));
    expect(utf8Button).toBeEnabled();
    expect(windows1251Button).toBeEnabled();

    parseSpy.mockRestore();
  });
});

// Fix 3 (CodeRabbit, PR #65): parseCsv's `errors` (PapaParse's own
// malformed-row diagnostics, e.g. a row with fewer fields than the header)
// were previously read and discarded — a genuinely malformed CSV could
// silently carry garbage rows into step 2 with zero warning. The FULL parse
// (the step 1->2 transition, handleContinue) is the one that matters and
// gets blocked; the 3-row preview parse doesn't need this treatment.
describe("ImportWizard step 1 — malformed CSV validation", () => {
  it("does not advance to step 2 and shows a validation message when the full parse reports row-count-mismatch errors", async () => {
    const user = userEvent.setup();
    // Row 2 has one fewer field than the 3-column header — PapaParse's own
    // parser flags this via results.errors (verified directly against
    // papaparse in parseCsv.test.ts).
    const malformedCsv = "Name,Email,Company\nPerson 1,person1@example.com,Acme\nPerson 2,person2@example.com\n";
    const file = new File([malformedCsv], "malformed.csv", { type: "text/csv" });
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);

    await user.upload(screen.getByLabelText("Choose a CSV file"), file);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue → Columns" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));

    expect(
      await screen.findByText("This file has rows that don't match the header row's column count — fix the CSV and try again."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");
    expect(screen.getByTestId("import-step-2")).toHaveAttribute("data-step-status", "future");
  });

  it("clears the validation message and advances normally once a well-formed file replaces the malformed one", async () => {
    const user = userEvent.setup();
    const malformedCsv = "Name,Email,Company\nPerson 1,person1@example.com,Acme\nPerson 2,person2@example.com\n";
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), new File([malformedCsv], "malformed.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue → Columns" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
    await screen.findByText("This file has rows that don't match the header row's column count — fix the CSV and try again.");

    await user.click(screen.getByRole("button", { name: "Replace" }));
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");

    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));

    expect(await screen.findByTestId("import-step-2")).toHaveAttribute("data-step-status", "current");
    expect(
      screen.queryByText("This file has rows that don't match the header row's column count — fix the CSV and try again."),
    ).not.toBeInTheDocument();
  });
});

// Distinct fixture from the step-1 tests above: 4 columns (one of which,
// "Примечание", has no default-mapping heuristic match) and 5 DATA rows —
// deliberately more than the 3-row preview Task 11's file-pick step shows,
// so assertions here can only pass if the step 1->2 transition genuinely
// re-parses the WHOLE file rather than reusing the leftover 3-row preview.
// Row 5 is a case-insensitive duplicate of row 1's email, so a correct full
// parse + in-file dedup collapses 5 rows down to 4 with 1 merged duplicate
// — a result that's structurally impossible to produce from only 3 parsed
// rows, since the duplicate (row 5) wouldn't even exist yet.
const STEP2_CSV = [
  "ФИО,Компания,Email,Примечание",
  "Анна Иванова,Ромашка,anna@example.com,",
  "Олег Петров,Вектор,oleg@example.com,VIP",
  "Мария Сидорова,Старт,maria@example.com,",
  "Иван Кузнецов,Ромашка,ivan@example.com,",
  "Анна Иванова,Ромашка,ANNA@EXAMPLE.com,dup",
  "",
].join("\n");

function buildStep2File(name = "участники.csv"): File {
  return new File([STEP2_CSV], name, { type: "text/csv" });
}

async function continueToStep2(user: ReturnType<typeof userEvent.setup>) {
  renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
  await user.upload(screen.getByLabelText("Choose a CSV file"), buildStep2File());
  await screen.findByText("Auto-detected");
  await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
  await screen.findByTestId("import-step-2");
}

describe("ImportWizard step 2 — column mapping", () => {
  it("full-parses the whole file (not just the 3-row preview) and prefills the default mapping heuristic", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    // Default-mapping heuristic: ФИО (no separate Фамилия column) maps to
    // first_name ONLY — no fabricated split. Компания/Email match their
    // heuristics. Примечание matches nothing and defaults to unset.
    expect(screen.getByRole("combobox", { name: "ФИО" })).toHaveValue("first_name");
    expect(screen.getByRole("combobox", { name: "Компания" })).toHaveValue("company");
    expect(screen.getByRole("combobox", { name: "Email" })).toHaveValue("email");
    expect(screen.getByRole("combobox", { name: "Примечание" })).toHaveValue("unset");

    // Proof the full file (5 data rows, 1 email duplicate) was parsed, not
    // the 3-row preview: footer shows 4 post-dedup rows with 1 merged
    // duplicate — impossible if only 3 rows were ever parsed.
    expect(screen.getByText("4 rows · 1 duplicates merged by email")).toBeInTheDocument();
  });

  it("shows the mapped Фамилия column as last_name when both name-like columns exist", async () => {
    const user = userEvent.setup();
    renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    const file = new File(
      ["Имя,Фамилия,Email\nАнна,Иванова,anna@example.com\nОлег,Петров,oleg@example.com\n"],
      "участники2.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText("Choose a CSV file"), file);
    await screen.findByText("Auto-detected");
    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
    await screen.findByTestId("import-step-2");

    expect(screen.getByRole("combobox", { name: "Имя" })).toHaveValue("first_name");
    expect(screen.getByRole("combobox", { name: "Фамилия" })).toHaveValue("last_name");
  });

  it("shows an unmapped column with amber warning styling and blocks Import N rows", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    const importButton = screen.getByRole("button", { name: /Import \d+ rows/ });
    expect(importButton).toBeDisabled();
    expect(screen.getByText("Column unmapped — pick a field or confirm skipping it")).toBeInTheDocument();
  });

  it("unblocks Import N rows once the unmapped column is explicitly set to Don't import", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    const importButton = screen.getByRole("button", { name: /Import \d+ rows/ });
    expect(importButton).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Примечание" }), "skip");

    expect(importButton).toBeEnabled();
    expect(screen.queryByText("Column unmapped — pick a field or confirm skipping it")).not.toBeInTheDocument();
  });

  it("updates the live row count and duplicate caption as the email mapping changes", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    expect(screen.getByText("4 rows · 1 duplicates merged by email")).toBeInTheDocument();

    // Un-map Email (send it to skip) — with no column mapped to email
    // anymore, dedup no longer applies and all 5 rows count.
    await user.selectOptions(screen.getByRole("combobox", { name: "Email" }), "skip");

    expect(screen.getByText("5 rows")).toBeInTheDocument();
    expect(screen.queryByText(/duplicates merged/)).not.toBeInTheDocument();
  });

  it("Back returns to step 1 with the picked file and encoding preserved (not reset)", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    await user.click(screen.getByRole("button", { name: "← Back" }));

    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");
    expect(screen.getByText("участники.csv")).toBeInTheDocument();
    expect(screen.getByText("Auto-detected")).toBeInTheDocument();
    // STEP2_CSV is a genuine UTF-8 fixture (not windows-1251 bytes), so
    // auto-detect should have picked UTF-8 — the point here is that this
    // choice survived the round trip through step 2 and back, not which
    // specific encoding it is.
    expect(screen.getByRole("button", { name: "UTF-8" })).toHaveAttribute("aria-pressed", "true");
  });
});

// Fix 1 (CodeRabbit, PR #65): buildBulkPayload's row-building loop silently
// lets the LAST column processed for a colliding target key win — no error,
// no indication, just quiet last-write-wins data loss. validateMapping is
// the guard; these tests exercise it wired into the UI: the mapping grid's
// amber highlighting, the summary warning, and the "Import N rows" button's
// disabled state.
describe("ImportWizard step 2 — mapping validation (duplicate/blank targets)", () => {
  it("(a) flags two columns mapped to the same standard field, disables Import, and shows the mapping warning", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    // Примечание defaults to unset; mapping it to the SAME standard field
    // ("email") that the Email column already uses creates a collision.
    await user.selectOptions(screen.getByRole("combobox", { name: "Примечание" }), "email");

    const importButton = screen.getByRole("button", { name: /Import \d+ rows/ });
    expect(importButton).toBeDisabled();
    expect(
      screen.getByText(
        "Some columns map to the same field or have a blank custom field name — fix the highlighted columns before importing.",
      ),
    ).toBeInTheDocument();
    // Both offending columns' sample cells show the per-row marker.
    expect(screen.getAllByText("Duplicate or blank field name")).toHaveLength(2);
  });

  it("(b) flags a custom field whose name is blank, disables Import, and shows the mapping warning", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    await user.selectOptions(screen.getByRole("combobox", { name: "Примечание" }), "custom");
    const nameInput = screen.getByRole("textbox", { name: "Custom field name: Примечание" });
    await user.clear(nameInput);

    const importButton = screen.getByRole("button", { name: /Import \d+ rows/ });
    expect(importButton).toBeDisabled();
    expect(
      screen.getByText(
        "Some columns map to the same field or have a blank custom field name — fix the highlighted columns before importing.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Duplicate or blank field name")).toHaveLength(1);
  });

  it("(c) flags a custom field name colliding with a standard field key used elsewhere, disables Import, and shows the mapping warning", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    await user.selectOptions(screen.getByRole("combobox", { name: "Примечание" }), "custom");
    const nameInput = screen.getByRole("textbox", { name: "Custom field name: Примечание" });
    await user.clear(nameInput);
    // Collides with the standard "email" key the Email column already uses.
    await user.type(nameInput, "email");

    const importButton = screen.getByRole("button", { name: /Import \d+ rows/ });
    expect(importButton).toBeDisabled();
    expect(
      screen.getByText(
        "Some columns map to the same field or have a blank custom field name — fix the highlighted columns before importing.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Duplicate or blank field name")).toHaveLength(2);
  });

  it("(d) clears the warning and re-enables Import once the colliding mapping is fixed", async () => {
    const user = userEvent.setup();
    await continueToStep2(user);

    await user.selectOptions(screen.getByRole("combobox", { name: "Примечание" }), "email");
    expect(screen.getByRole("button", { name: /Import \d+ rows/ })).toBeDisabled();

    // Fix it: send Примечание to skip instead (no longer collides, and no
    // longer unset either).
    await user.selectOptions(screen.getByRole("combobox", { name: "Примечание" }), "skip");

    expect(screen.getByRole("button", { name: /Import \d+ rows/ })).toBeEnabled();
    expect(
      screen.queryByText(
        "Some columns map to the same field or have a blank custom field name — fix the highlighted columns before importing.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Duplicate or blank field name")).not.toBeInTheDocument();
  });
});

// Task 13 — step 3: chunked import submission, progress, per-row errors.
// No shared default handler here: each test registers exactly the
// `server.use()` handler its own fixture needs, so a test's assertions
// can't accidentally pass against the WRONG branch of some generic
// catch-all mock.
const server = startMswServer();

// Genuinely subscribed observer for GET /api/events/:id/readiness — same
// ReadinessObserver pattern as AddAttendeeDialog.test.tsx: mounting a real
// useQuery consumer alongside the wizard makes `invalidateQueries` for
// READINESS_KEY produce an OBSERVABLE refetch (via `readinessHitCount`),
// rather than merely asserting the invalidate call was made. Only the test
// that mounts this registers the readiness GET handler (per the
// no-shared-default-handler rule above).
let readinessHitCount = 0;
function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

// jsdom's Blob doesn't implement `.text()`/`.arrayBuffer()` — same
// FileReader-based workaround as exportCsv.test.ts.
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer);
      resolve(text);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// Generates rowCount unique-email rows ("Name,Email" headers, both of which
// the default-mapping heuristic maps automatically — "Name" -> first_name,
// "Email" -> email) so continueToStep3 never needs manual mapping
// interaction. Absolute row N's data is always exactly "Person N" /
// "personN@example.com", which is what makes asserting against a specific
// absolute row number (e.g. row 505 in the two-chunk test) trustworthy.
function buildFixtureCsv(rowCount: number): string {
  const lines = ["Name,Email"];
  for (let i = 1; i <= rowCount; i += 1) {
    lines.push(`Person ${i},person${i}@example.com`);
  }
  return lines.join("\n");
}

async function continueToStep3Ready(user: ReturnType<typeof userEvent.setup>, csv: string, filename = "fixture.csv") {
  const onOpenChange = vi.fn();
  const rendered = renderWizard(<ImportWizard eventId="evt-1" open onOpenChange={onOpenChange} />);
  const file = new File([csv], filename, { type: "text/csv" });
  await user.upload(screen.getByLabelText("Choose a CSV file"), file);
  await screen.findByText("Auto-detected");
  await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
  await screen.findByTestId("import-step-2");
  return { ...rendered, onOpenChange };
}

describe("ImportWizard step 3 — chunked import", () => {
  it(
    "POSTs 500-row chunks sequentially (not in parallel), accumulates progress, and maps chunk-relative "
    + "error rows to absolute file rows across chunks",
    async () => {
      const user = userEvent.setup();
      const receivedBodies: Array<{ attendees: Record<string, unknown>[]; field_schema: string[] }> = [];
      // Both big chunks are gated independently (not just the first) — with
      // only chunk 1 gated, resolving it lets chunk 2 (immediately
      // ungated) complete in the same microtask flush that updates
      // progress, so the "between chunks" intermediate render is too
      // fleeting for `waitFor` to reliably observe. Gating both makes the
      // intermediate state deterministic to assert against.
      const firstChunkGate = createGate();
      const secondChunkGate = createGate();
      server.use(
        http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
          const body = (await request.json()) as { attendees: Record<string, unknown>[]; field_schema: string[] };
          receivedBodies.push(body);
          if (body.attendees.length === 1) {
            // Task 13's per-row Retry: a batch-of-1 re-POST.
            return HttpResponse.json({ message: "ok", created: 1, skipped: 0, total: 1 }, { status: 201 });
          }
          if (body.attendees.length === 500) {
            // The first (full) 500-row chunk — gated so the test can prove
            // the SECOND chunk is only requested after this one resolves
            // (sequential submission, never Promise.all).
            await firstChunkGate.promise;
            return HttpResponse.json(
              {
                message: "ok",
                created: 498,
                skipped: 2,
                total: 500,
                errors: [
                  { row: 3, data: "Person 3", problem: "duplicate_code" },
                  { row: 500, data: "Person 500", problem: "duplicate_email" },
                ],
              },
              { status: 201 },
            );
          }
          // The second (20-row remainder) chunk.
          await secondChunkGate.promise;
          return HttpResponse.json(
            {
              message: "ok",
              created: 19,
              skipped: 1,
              total: 20,
              errors: [{ row: 5, data: "Person 505", problem: "create_failed" }],
            },
            { status: 201 },
          );
        }),
      );

      const { queryClient, onOpenChange } = await continueToStep3Ready(user, buildFixtureCsv(520), "big.csv");
      await user.click(screen.getByRole("button", { name: "Import 520 rows" }));

      // Step 3 entered: progress shows immediately, first chunk request
      // received but its response is withheld by the gate.
      expect(await screen.findByText("0 of 520 imported")).toBeInTheDocument();
      await waitFor(() => expect(receivedBodies).toHaveLength(1));
      expect(receivedBodies[0].attendees).toHaveLength(500);
      expect(receivedBodies[0].field_schema).toEqual(["first_name", "email"]);
      // The loop is synchronously blocked awaiting chunk 1's mutateAsync —
      // a Promise.all implementation would have already sent chunk 2 too.
      expect(receivedBodies).toHaveLength(1);

      // No close affordance while a chunk is in flight — no ✕, and Escape
      // doesn't dismiss the dialog either.
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();

      firstChunkGate.resolve();

      // Between-chunks: chunk 1 has resolved (progress updated) but chunk
      // 2's response is still withheld — genuinely observable, not a race.
      await waitFor(() => screen.getByText("498 of 520 imported"));
      await waitFor(() => expect(receivedBodies).toHaveLength(2));
      expect(receivedBodies[1].attendees).toHaveLength(20);
      expect(receivedBodies[1].field_schema).toEqual(["first_name", "email"]);
      expect(screen.getByText("498 of 520 imported")).toBeInTheDocument();

      secondChunkGate.resolve();

      await waitFor(() => screen.getByText("517 of 520 imported"));
      expect(screen.getByText("3 rows need attention.")).toBeInTheDocument();
      expect(
        screen.getByText("Valid rows are already in the list — fix these here or download them as CSV."),
      ).toBeInTheDocument();

      // Chunk-relative row 3 in chunk index 0 -> absolute row 3.
      const row3 = screen.getByText("Person 3").closest("tr")!;
      expect(within(row3).getByText("3")).toBeInTheDocument();
      expect(within(row3).getByText("Duplicate — same code as an existing attendee")).toBeInTheDocument();
      const skipRow3 = within(row3).getByRole("button", { name: "Skip" });

      // Chunk-relative row 500 in chunk index 0 -> absolute row 500.
      const row500 = screen.getByText("Person 500").closest("tr")!;
      expect(within(row500).getByText("500")).toBeInTheDocument();
      expect(within(row500).getByText("Duplicate — same email as an existing attendee")).toBeInTheDocument();

      // Chunk-relative row 5 in chunk index 1 -> absolute row 500 + 5 = 505.
      const row505 = screen.getByText("Person 505").closest("tr")!;
      expect(within(row505).getByText("505")).toBeInTheDocument();
      expect(within(row505).getByText("Couldn't be saved")).toBeInTheDocument();
      const retryRow505 = within(row505).getByRole("button", { name: "Retry" });

      // Skip (duplicate_code, row 3): removes from the list, no network call.
      await user.click(skipRow3);
      expect(screen.queryByText("Person 3")).not.toBeInTheDocument();
      expect(receivedBodies).toHaveLength(2);
      expect(screen.getByText("2 rows need attention.")).toBeInTheDocument();

      // Retry (create_failed, row 505): re-POSTs exactly that one row.
      await user.click(retryRow505);
      await waitFor(() => expect(receivedBodies).toHaveLength(3));
      expect(receivedBodies[2].attendees).toEqual([{ first_name: "Person 505", email: "person505@example.com" }]);
      await waitFor(() => expect(screen.queryByText("Person 505")).not.toBeInTheDocument());
      await waitFor(() => screen.getByText("518 of 520 imported"));
      expect(screen.getByText("1 rows need attention.")).toBeInTheDocument();

      // Skip the last remaining error (duplicate_email, row 500) too.
      await user.click(within(screen.getByText("Person 500").closest("tr")!).getByRole("button", { name: "Skip" }));
      expect(screen.queryByText(/rows need attention/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();

      // Done: invalidates the attendees list and closes the wizard.
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      await user.click(screen.getByRole("button", { name: "Done — 518 in the list" }));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEES_LIST_KEY("evt-1") });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it("Done invalidates the readiness aggregate too (observable refetch) — the imported rows change the rail's attendees count", async () => {
    readinessHitCount = 0;
    const user = userEvent.setup();
    server.use(
      http.get("http://api.test/api/events/:id/readiness", () => {
        readinessHitCount += 1;
        return HttpResponse.json({ ready: false, steps: [] });
      }),
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
        const body = (await request.json()) as { attendees: unknown[] };
        return HttpResponse.json(
          { message: "ok", created: body.attendees.length, skipped: 0, total: body.attendees.length },
          { status: 201 },
        );
      }),
    );

    const onOpenChange = vi.fn();
    renderWizard(
      <>
        <ReadinessObserver eventId="evt-1" />
        <ImportWizard eventId="evt-1" open onOpenChange={onOpenChange} />
      </>,
    );
    await waitFor(() => expect(readinessHitCount).toBe(1));

    const file = new File([buildFixtureCsv(3)], "fixture.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Choose a CSV file"), file);
    await screen.findByText("Auto-detected");
    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
    await screen.findByTestId("import-step-2");
    await user.click(screen.getByRole("button", { name: "Import 3 rows" }));

    await user.click(await screen.findByRole("button", { name: "Done — 3 in the list" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The genuinely subscribed readiness observer actually refetches —
    // not just an invalidateQueries call asserted in isolation.
    await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
  });

  it("downloads a CSV of the original source rows for exactly the rows still in the error list", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
        const body = (await request.json()) as { attendees: unknown[] };
        return HttpResponse.json(
          {
            message: "ok",
            created: body.attendees.length - 1,
            skipped: 1,
            total: body.attendees.length,
            errors: [{ row: 2, data: "Person 2", problem: "create_failed" }],
          },
          { status: 201 },
        );
      }),
    );

    await continueToStep3Ready(user, buildFixtureCsv(3), "small.csv");
    await user.click(screen.getByRole("button", { name: "Import 3 rows" }));
    await screen.findByText("2 of 3 imported");
    expect(screen.getByText("Person 2")).toBeInTheDocument();

    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: "Download 1 rows as CSV" }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    const text = await readBlobAsText(blobArg);
    expect(text.startsWith("﻿")).toBe(true);
    // The ORIGINAL source row (raw "Name"/"Email" header-keyed values), not
    // the transformed {first_name, email} attendee object.
    expect(text.slice(1).split("\r\n")).toEqual(["Name,Email", "Person 2,person2@example.com"]);

    vi.restoreAllMocks();
  });

  // Fix 4 (CodeRabbit, PR #65): dedupeByEmail drops duplicate rows, which
  // re-indexes everything after them — mapChunkRowToAbsolute's return value
  // is a POST-DEDUP position, not the row's actual position in the source
  // file. Source row 2 here is an in-file duplicate of row 1's email and
  // gets removed BEFORE row 3 (which later errors), so the post-dedup
  // position of row 3 is 2 — this proves the UI shows the TRUE original
  // file row (3), not the post-dedup position (2), and that the CSV
  // download still retrieves row 3's actual source data.
  it("shows the TRUE original file row number (not the post-dedup position) when an earlier in-file duplicate was removed, and downloads the correct source row", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
        const body = (await request.json()) as { attendees: unknown[] };
        // Post-dedup, only 2 attendees are ever submitted (PersonA, PersonC)
        // — the second (chunk-relative row 2) errors.
        return HttpResponse.json(
          {
            message: "ok",
            created: body.attendees.length - 1,
            skipped: 0,
            total: body.attendees.length,
            errors: [{ row: 2, data: "PersonC", problem: "create_failed" }],
          },
          { status: 201 },
        );
      }),
    );

    const dupCsv = [
      "Name,Email",
      "PersonA,a@example.com", // source row 1
      "PersonADup,a@example.com", // source row 2 — dropped as a duplicate of row 1
      "PersonC,c@example.com", // source row 3 — this one errors
    ].join("\n");

    await continueToStep3Ready(user, dupCsv, "dup-then-error.csv");
    // Post-dedup total is 2 rows (1 merged duplicate).
    await user.click(screen.getByRole("button", { name: "Import 2 rows" }));
    await screen.findByText("1 of 2 imported");

    // The error row must read "3" (the TRUE source-file row for PersonC),
    // never "2" (PersonC's post-dedup position).
    const errorRow = screen.getByText("PersonC").closest("tr")!;
    expect(within(errorRow).getByText("3")).toBeInTheDocument();
    expect(within(errorRow).queryByText("2")).not.toBeInTheDocument();

    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: "Download 1 rows as CSV" }));

    const blobArg = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    const text = await readBlobAsText(blobArg);
    // The CSV download must still retrieve PersonC's actual source row,
    // despite the row-number/array-index divergence caused by the dropped
    // duplicate.
    expect(text.slice(1).split("\r\n")).toEqual(["Name,Email", "PersonC,c@example.com"]);

    vi.restoreAllMocks();
  });

  it("marks all un-sent rows as failed on a chunk-level network failure, and Retry remaining resumes to completion", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async () => {
        callCount += 1;
        if (callCount === 1) {
          // A network-level failure — the mutation itself rejects, not a
          // per-row error inside a successful response.
          return HttpResponse.error();
        }
        return HttpResponse.json({ message: "ok", created: 5, skipped: 0, total: 5 }, { status: 201 });
      }),
    );

    await continueToStep3Ready(user, buildFixtureCsv(5), "tiny.csv");
    await user.click(screen.getByRole("button", { name: "Import 5 rows" }));

    expect(await screen.findByText("Upload interrupted — 5 rows not sent yet.")).toBeInTheDocument();
    // Settled (nothing actively in flight) even before Retry remaining is
    // clicked — the Done footer is already available here (see the
    // "stays dismissable ... even when every retry keeps failing" test
    // below for the case where the operator never retries at all).
    expect(screen.getByRole("button", { name: "Done — 0 in the list" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry remaining" }));

    await waitFor(() => screen.getByText("5 of 5 imported"));
    expect(screen.queryByText(/rows not sent yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done — 5 in the list" })).toBeInTheDocument();
  });

  // Fix (Codex, PR #65): a chunk-level failure that NEVER succeeds (e.g. the
  // backend's attendees_per_event limit rejecting every retry) used to leave
  // isStep3Busy permanently true and the footer's render condition
  // permanently false — no Close button, no Done, no way out short of a
  // page reload. Once the failed attempt has SETTLED (nothing actively in
  // flight), the dialog must be dismissable and offer Done, even though
  // chunkFailure itself is still set and "Retry remaining" keeps failing.
  it("stays dismissable via Done after a chunk-level failure settles, even when every retry keeps failing", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async () => HttpResponse.error()),
    );

    const { queryClient, onOpenChange } = await continueToStep3Ready(user, buildFixtureCsv(5), "persistent-fail.csv");
    await user.click(screen.getByRole("button", { name: "Import 5 rows" }));

    expect(await screen.findByText("Upload interrupted — 5 rows not sent yet.")).toBeInTheDocument();

    // Settled (nothing in flight) even though chunkFailure is still set —
    // the dialog must already be closable and offer Done, without the user
    // clicking "Retry remaining" at all.
    const closeButton = await screen.findByRole("button", { name: "Close" });
    expect(closeButton).toBeEnabled();
    const doneButton = screen.getByRole("button", { name: "Done — 0 in the list" });
    expect(doneButton).toBeEnabled();
    // The chunk-failure banner and its Retry remaining affordance stay
    // available alongside Done — closing isn't the only option.
    expect(screen.getByRole("button", { name: "Retry remaining" })).toBeInTheDocument();

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(doneButton);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEES_LIST_KEY("evt-1") });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Fix round 1 (plan line 62's reconciliation decision): step 3 is only
  // non-dismissable while genuinely busy — once every chunk has settled, the
  // X/Escape/outside-click paths must work too, AND must invalidate the
  // attendees list exactly like clicking "Done" does (Radix wires X/Escape/
  // outside-click straight to the raw onOpenChange prop, bypassing
  // handleDone's invalidateQueries call unless that prop itself invalidates).
  it("becomes closable via the X once step 3 has settled, and closing that way invalidates the attendees list same as Done", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
        const body = (await request.json()) as { attendees: unknown[] };
        return HttpResponse.json(
          { message: "ok", created: body.attendees.length, skipped: 0, total: body.attendees.length },
          { status: 201 },
        );
      }),
    );

    const { queryClient, onOpenChange } = await continueToStep3Ready(user, buildFixtureCsv(3), "closeable.csv");
    await user.click(screen.getByRole("button", { name: "Import 3 rows" }));
    await screen.findByText("3 of 3 imported");

    // Settled: hideClose removes the X from the DOM entirely while busy, so
    // its mere presence here proves the dialog is genuinely closable now.
    const closeButton = screen.getByRole("button", { name: "Close" });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(closeButton);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEES_LIST_KEY("evt-1") });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog non-closable while a per-row Retry is in flight, even though the chunk-import phase already settled", async () => {
    const user = userEvent.setup();
    const retryGate = createGate();
    let retryRequested = false;
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
        const body = (await request.json()) as { attendees: Record<string, unknown>[] };
        if (body.attendees.length === 1) {
          // The per-row Retry re-POST — gated so the test can attempt to
          // close the dialog while it's genuinely still in flight.
          retryRequested = true;
          await retryGate.promise;
          return HttpResponse.json({ message: "ok", created: 1, skipped: 0, total: 1 }, { status: 201 });
        }
        return HttpResponse.json(
          {
            message: "ok",
            created: body.attendees.length - 1,
            skipped: 1,
            total: body.attendees.length,
            errors: [{ row: 2, data: "Person 2", problem: "create_failed" }],
          },
          { status: 201 },
        );
      }),
    );

    const { onOpenChange } = await continueToStep3Ready(user, buildFixtureCsv(3), "retry-inflight.csv");
    await user.click(screen.getByRole("button", { name: "Import 3 rows" }));
    await screen.findByText("2 of 3 imported");

    // The main chunk-import phase has fully settled (no chunk in flight, no
    // chunkFailure) — the dialog is closable right now.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryRequested).toBe(true));

    // Mid single-row-retry: non-closable again, even though the chunk-import
    // phase settled long before this retry started.
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    retryGate.resolve();

    await waitFor(() => screen.getByText("3 of 3 imported"));
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  // Fix round 2: a re-review found the footer's "Done" button was still
  // gated on the OLD, narrower `!isImporting && !chunkFailure` condition —
  // NOT `isStep3Busy` (which the X/Escape/outside-click dismiss paths above
  // already correctly use). Concretely: once the main chunk-import phase
  // settles with a create_failed row still listed, Done rendered fully
  // clickable with no `disabled`, so clicking it while a per-row Retry was
  // still in flight ran `handleDone()` immediately — invalidating the
  // attendees list and tearing the wizard down BEFORE the retried row
  // existed server-side. When the retry later resolved into a reset wizard,
  // it never re-invalidated, so the recovered attendee silently never
  // appeared until some unrelated future refetch.
  it("disables Done while a per-row Retry is in flight (even though the chunk-import phase already settled), and Done works normally once the retry resolves", async () => {
    const user = userEvent.setup();
    const retryGate = createGate();
    let retryRequested = false;
    server.use(
      http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
        const body = (await request.json()) as { attendees: Record<string, unknown>[] };
        if (body.attendees.length === 1) {
          // The per-row Retry re-POST — gated so the test can attempt to
          // click Done while it's genuinely still in flight.
          retryRequested = true;
          await retryGate.promise;
          return HttpResponse.json({ message: "ok", created: 1, skipped: 0, total: 1 }, { status: 201 });
        }
        return HttpResponse.json(
          {
            message: "ok",
            created: body.attendees.length - 1,
            skipped: 1,
            total: body.attendees.length,
            errors: [{ row: 2, data: "Person 2", problem: "create_failed" }],
          },
          { status: 201 },
        );
      }),
    );

    const { queryClient, onOpenChange } = await continueToStep3Ready(user, buildFixtureCsv(3), "done-inflight.csv");
    await user.click(screen.getByRole("button", { name: "Import 3 rows" }));
    await screen.findByText("2 of 3 imported");

    // Chunk-import phase has settled (no chunk in flight, no chunkFailure):
    // Done renders and is enabled right now.
    const doneButton = screen.getByRole("button", { name: "Done — 2 in the list" });
    expect(doneButton).toBeEnabled();

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryRequested).toBe(true));

    // Mid single-row-retry: Done is disabled. Attempting to click it anyway
    // (userEvent correctly skips firing the click on a disabled element,
    // same as a real browser) must NOT run handleDone's invalidate/close
    // side effects — proving this isn't just a cosmetic disabled state.
    expect(doneButton).toBeDisabled();
    await user.click(doneButton);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    retryGate.resolve();

    // Once the retry resolves, Done becomes available again (new count
    // reflecting the recovered row) and works normally.
    await waitFor(() => screen.getByText("3 of 3 imported"));
    const settledDoneButton = screen.getByRole("button", { name: "Done — 3 in the list" });
    expect(settledDoneButton).toBeEnabled();

    await user.click(settledDoneButton);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ATTENDEES_LIST_KEY("evt-1") });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Fix round 3: `runChunksFrom`'s periodic setState accumulated `done`/
  // `errors` in closure-local variables across the chunk loop's iterations
  // and wrote them out wholesale after each chunk resolved — NOT a
  // functional update genuinely derived from `prev`. Step 3's error table
  // isn't gated by isImporting, so a row from an earlier chunk can be
  // Skipped/Retried by the user WHILE a later chunk is still in flight; a
  // successful Retry in that window correctly applies a prev-based update
  // (row removed, `done` incremented). But when the still-in-flight later
  // chunk then resolved, its setState overwrote importProgress/rowErrors
  // with its own stale closure snapshot — silently reverting the retry:
  // the fixed row reappeared with an enabled Retry (inviting a duplicate
  // submission) and the progress count regressed below what had already
  // been achieved. This test reproduces that exact interleaving and
  // asserts it no longer happens.
  it(
    "does not revert a Retry applied to an earlier chunk's error row while a later chunk is still in flight",
    async () => {
      const user = userEvent.setup();
      const receivedBodies: Array<{ attendees: Record<string, unknown>[] }> = [];
      const firstChunkGate = createGate();
      const secondChunkGate = createGate();
      server.use(
        http.post("http://api.test/api/events/:eventId/attendees/bulk", async ({ request }) => {
          const body = (await request.json()) as { attendees: Record<string, unknown>[] };
          receivedBodies.push(body);
          if (body.attendees.length === 1) {
            // The per-row Retry re-POST for chunk 1's row 3 — deliberately
            // NOT gated, so it resolves well before chunk 2 does.
            return HttpResponse.json({ message: "ok", created: 1, skipped: 0, total: 1 }, { status: 201 });
          }
          if (body.attendees.length === 500) {
            // Chunk 1 — resolves with a single create_failed error at row 3
            // once gated open.
            await firstChunkGate.promise;
            return HttpResponse.json(
              {
                message: "ok",
                created: 499,
                skipped: 1,
                total: 500,
                errors: [{ row: 3, data: "Person 3", problem: "create_failed" }],
              },
              { status: 201 },
            );
          }
          // Chunk 2 (the 20-row remainder) — stays gated until after the
          // chunk-1 error row has already been retried to success.
          await secondChunkGate.promise;
          return HttpResponse.json({ message: "ok", created: 20, skipped: 0, total: 20 }, { status: 201 });
        }),
      );

      await continueToStep3Ready(user, buildFixtureCsv(520), "race.csv");
      await user.click(screen.getByRole("button", { name: "Import 520 rows" }));

      await waitFor(() => expect(receivedBodies).toHaveLength(1));
      expect(receivedBodies[0].attendees).toHaveLength(500);

      firstChunkGate.resolve();

      // Chunk 1 has settled (progress reflects it, row 3's error is live)
      // while chunk 2 is now in flight but still gated shut.
      await waitFor(() => screen.getByText("499 of 520 imported"));
      await waitFor(() => expect(receivedBodies).toHaveLength(2));
      expect(receivedBodies[1].attendees).toHaveLength(20);
      const row3 = screen.getByText("Person 3").closest("tr")!;
      const retryRow3 = within(row3).getByRole("button", { name: "Retry" });

      // Retry row 3 WHILE chunk 2 is still in flight, and let it resolve
      // fully (its own, ungated response) before chunk 2 does.
      await user.click(retryRow3);
      await waitFor(() => expect(receivedBodies).toHaveLength(3));
      expect(receivedBodies[2].attendees).toEqual([{ first_name: "Person 3", email: "person3@example.com" }]);
      await waitFor(() => expect(screen.queryByText("Person 3")).not.toBeInTheDocument());
      await waitFor(() => screen.getByText("500 of 520 imported"));
      expect(screen.queryByText(/rows need attention/)).not.toBeInTheDocument();

      // NOW let chunk 2 resolve — its setState must merge its own +20 onto
      // whatever is CURRENT (500, from the retry), not overwrite with a
      // stale closure snapshot that still thinks row 3 is unresolved and
      // done is only 499.
      secondChunkGate.resolve();

      await waitFor(() => screen.getByText("520 of 520 imported"));
      // The retried row must not reappear, and the progress count must not
      // regress at any point after chunk 2 settles.
      expect(screen.queryByText("Person 3")).not.toBeInTheDocument();
      expect(screen.queryByText(/rows need attention/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Done — 520 in the list" })).toBeInTheDocument();
    },
  );
});
