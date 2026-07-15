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

  it("advances the step indicator to step 2 (with a stub body) when Continue is clicked", async () => {
    const user = userEvent.setup();
    render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");

    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));

    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "done");
    expect(screen.getByTestId("import-step-2")).toHaveAttribute("data-step-status", "current");
    expect(screen.getByTestId("import-step-3")).toHaveAttribute("data-step-status", "future");
    expect(screen.getByText("This section is coming in a later phase.")).toBeInTheDocument();
  });

  it("resets to step 1 with no file when closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Choose a CSV file"), buildWin1251File());
    await screen.findByText("Auto-detected");
    await user.click(screen.getByRole("button", { name: "Continue → Columns" }));
    expect(screen.getByTestId("import-step-2")).toHaveAttribute("data-step-status", "current");

    rerender(<ImportWizard eventId="evt-1" open={false} onOpenChange={vi.fn()} />);
    rerender(<ImportWizard eventId="evt-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("import-step-1")).toHaveAttribute("data-step-status", "current");
    expect(screen.queryByText("Auto-detected")).not.toBeInTheDocument();
  });
});
