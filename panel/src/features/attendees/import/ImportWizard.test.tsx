import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { ImportWizard } from "./ImportWizard";
import { decodeBuffer } from "./encoding";
import { parseCsv } from "./parseCsv";
import { ATTENDEES_LIST_KEY } from "../hooks";
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

// Task 13 — step 3: chunked import submission, progress, per-row errors.
// No shared default handler here: each test registers exactly the
// `server.use()` handler its own fixture needs, so a test's assertions
// can't accidentally pass against the WRONG branch of some generic
// catch-all mock.
const server = startMswServer();

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

function createGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
    // Not settled yet — no Done/Download footer while a retry is pending.
    expect(screen.queryByRole("button", { name: /Done/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry remaining" }));

    await waitFor(() => screen.getByText("5 of 5 imported"));
    expect(screen.queryByText(/rows not sent yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done — 5 in the list" })).toBeInTheDocument();
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
});
