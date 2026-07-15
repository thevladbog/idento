import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportWizard } from "./ImportWizard";
import { decodeBuffer } from "./encoding";
import { parseCsv } from "./parseCsv";
import "../../../shared/i18n";

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
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");
    expect(screen.getByTestId("import-step-2")).toHaveAttribute("data-step-status", "future");
    expect(screen.getByTestId("import-step-3")).toHaveAttribute("data-step-status", "future");
  });

  it("auto-detects windows-1251 for a real windows-1251 file and shows a correctly decoded preview", async () => {
    const user = userEvent.setup();
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);

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
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
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
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    const continueButton = screen.getByRole("button", { name: "Continue → Columns" });
    expect(continueButton).toBeDisabled();

    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");

    expect(continueButton).toBeEnabled();
  });

  it("advances the step indicator to step 2 (with the real mapping grid) when Continue is clicked", async () => {
    const user = userEvent.setup();
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
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
    const { rerender } = render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
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
  render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
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
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
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
