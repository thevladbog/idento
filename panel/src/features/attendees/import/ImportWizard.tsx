import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input,
} from "@idento/ui";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { decodeBuffer, detectEncoding, type CsvEncoding } from "./encoding";
import { parseCsv } from "./parseCsv";
import {
  buildBulkPayload, computeDefaultMapping,
  createInitialWizardState, type ImportWizardState, type MappingTarget, type StandardField,
} from "./wizardState";

// The 6 standard fields a CSV column can map to (Task 12's brief, verbatim
// order). Labels are NOT new i18n keys — first_name/last_name/email/
// company/position reuse the exact same addAttendee* keys AddAttendeeDialog
// and EditAttendeeForm already use for these field names, so the mapping
// dropdown's options say the same thing an operator sees everywhere else in
// the app. "code" has no addAttendee* precedent (attendee codes are
// server-generated, never a manual-entry field), so it gets its own key.
const STANDARD_FIELD_LABEL_KEYS: Record<StandardField, string> = {
  first_name: "addAttendeeFirstName",
  last_name: "addAttendeeLastName",
  email: "addAttendeeEmail",
  company: "addAttendeeCompany",
  position: "addAttendeePosition",
  code: "importFieldCode",
};
const STANDARD_FIELDS: StandardField[] = ["first_name", "last_name", "email", "company", "position", "code"];

export interface ImportWizardProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEP_LABEL_KEYS = { 1: "importStep1", 2: "importStep2", 3: "importStep3" } as const;
const STEPS = [1, 2, 3] as const;

// Simplest honest size humanizer for the file chip's metadata caption — same
// KB-below-1MiB / MB-above split as FontsCard.tsx's formatSize.
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Board 3a/3b/3c — the CSV import wizard's modal chrome (title + numbered
// step indicator) plus step 1 (file pick, encoding auto-detect with
// override, 3-row live preview) and step 2 (full-file parse + column
// mapping grid, Task 12). Step 3 (Task 13) is reachable via "Import N rows"
// but only renders a placeholder body here — this task's job stops short of
// the actual chunked-import submission flow.
export function ImportWizard({ eventId, open, onOpenChange }: ImportWizardProps) {
  void eventId; // Not read yet — wired once Task 13 actually submits the import.
  const { t } = useTranslation();
  const [state, setState] = React.useState<ImportWizardState>(createInitialWizardState);
  const [isFullParsing, setIsFullParsing] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Reset to a fresh step-1 state whenever the dialog transitions closed —
  // same reset-on-close convention as AddAttendeeDialog/CreateEventDialog —
  // so reopening never resumes a stale file/preview from a previous run.
  React.useEffect(() => {
    if (open) return;
    setState(createInitialWizardState());
  }, [open]);

  // Decodes `buffer` with `encoding` and re-parses just the first 3 rows for
  // the live preview. `worker: true` is the real production request (Task
  // 10's parseCsv/PapaParse only actually spins up a Worker when
  // `Papa.WORKERS_SUPPORTED`, i.e. `typeof Worker !== "undefined"` — verified
  // against papaparse's own source: `if (_config.worker &&
  // Papa.WORKERS_SUPPORTED)`). Under Vitest/jsdom there's no global `Worker`,
  // so this gracefully parses on the main thread in tests instead of
  // throwing — no test-only branch needed here. The full (non-preview) parse
  // of every row is deferred to the step 2->3 transition in Task 13, not
  // this preview call.
  async function loadPreview(buffer: ArrayBuffer, encoding: CsvEncoding) {
    const text = decodeBuffer(buffer, encoding);
    return parseCsv(text, { preview: 3, worker: true });
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same filename again still fires onChange.
    e.target.value = "";
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const encoding = detectEncoding(buffer);
    const { rows, headers } = await loadPreview(buffer, encoding);
    setState((prev) => ({
      ...prev,
      file,
      buffer,
      encoding,
      encodingOverridden: false,
      rows,
      headers,
    }));
  }

  async function handleEncodingChange(encoding: CsvEncoding) {
    if (!state.buffer) return;
    // Always re-decode + re-parse (cheap: 3 rows), even if `encoding`
    // already matches — clicking a segment always marks the choice as an
    // explicit user override, whether or not it actually changes the value.
    const { rows, headers } = await loadPreview(state.buffer, encoding);
    setState((prev) => ({ ...prev, encoding, encodingOverridden: true, rows, headers }));
  }

  function handleReplaceClick() {
    fileInputRef.current?.click();
  }

  // The step 1->2 transition trigger. Task 11 deliberately only parsed a
  // 3-row PREVIEW of the file (avoiding a wasteful double-parse just for
  // the preview) and deferred the full parse. This is where it happens: the
  // WHOLE file is re-decoded and re-parsed (no `preview` limit) before
  // `state.step` ever flips to 2, so step 2 always renders with real full
  // data (real total row count, real per-column samples) from its very
  // first render — never the leftover 3-row preview. `isFullParsing` gates
  // the Continue button (disabled + a spinner label) for the gap while a
  // large file is being re-parsed; small files resolve fast enough that the
  // gap is imperceptible, but nothing about this depends on file size.
  async function handleContinue() {
    if (!state.buffer) return;
    setIsFullParsing(true);
    try {
      const text = decodeBuffer(state.buffer, state.encoding);
      const { rows, headers } = await parseCsv(text, { worker: true });
      setState((prev) => ({
        ...prev,
        rows,
        headers,
        mapping: computeDefaultMapping(headers),
        step: 2,
      }));
    } finally {
      setIsFullParsing(false);
    }
  }

  function handleMappingChange(header: string, target: MappingTarget) {
    setState((prev) => ({ ...prev, mapping: { ...prev.mapping, [header]: target } }));
  }

  // Preserves file/buffer/encoding/rows/headers/mapping — only `step`
  // changes — so the operator never has to re-pick the file after a Back.
  function handleBack() {
    setState((prev) => ({ ...prev, step: 1 }));
  }

  // This task's job stops at advancing to step 3 with a stub body, mirroring
  // Task 11's own step-2-stub precedent — Task 13 builds the real submission
  // flow (chunked import against the API) behind this step.
  function handleImportRows() {
    setState((prev) => ({ ...prev, step: 3 }));
  }

  const canContinue = Boolean(state.file) && state.rows.length > 0;

  // Recomputed on every mapping/full-parse change — dedup depends on
  // WHICHEVER column is currently mapped to email, so it has to be live,
  // not computed once when step 2 mounts.
  const bulkPayload = React.useMemo(
    () => buildBulkPayload(state.rows, state.mapping),
    [state.rows, state.mapping],
  );
  const totalRowsAfterDedup = bulkPayload.attendees.length;
  const hasUnsetColumn = state.headers.some(
    (header) => (state.mapping[header] ?? { kind: "unset" as const }).kind === "unset",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Board widths: 3a (step 1) = 760px, 3b (step 2) = 860px card. */}
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        className={cn("max-w-[760px]", state.step === 2 && "max-w-[860px]")}
      >
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <StepIndicator currentStep={state.step} />
        </DialogHeader>

        {state.step === 1 ? (
          <Step1Body
            state={state}
            fileInputRef={fileInputRef}
            onFilePick={handleFilePick}
            onEncodingChange={handleEncodingChange}
            onReplaceClick={handleReplaceClick}
          />
        ) : state.step === 2 ? (
          <Step2Body state={state} onMappingChange={handleMappingChange} />
        ) : (
          <p className="text-body text-muted-foreground">{t("placeholderComingSoon")}</p>
        )}

        <DialogFooter>
          {state.step === 1 ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("createEventCancel")}
              </Button>
              <Button type="button" disabled={!canContinue || isFullParsing} onClick={handleContinue}>
                {isFullParsing ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                    {t("importParsingFull")}
                  </span>
                ) : (
                  t("importContinueColumns")
                )}
              </Button>
            </>
          ) : state.step === 2 ? (
            <>
              <p className="text-caption text-muted-foreground sm:mr-auto">
                {bulkPayload.mergedDuplicates > 0
                  ? t("importDuplicatesMerged", { rows: totalRowsAfterDedup, count: bulkPayload.mergedDuplicates })
                  : t("importRowsCaption", { rows: totalRowsAfterDedup })}
              </p>
              <Button type="button" variant="outline" onClick={handleBack}>
                {t("importBack")}
              </Button>
              <Button type="button" disabled={hasUnsetColumn} onClick={handleImportRows}>
                {t("importRowsCta", { count: totalRowsAfterDedup })}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("createEventCancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  return (
    <ol className="flex items-center gap-2" aria-label={t("importTitle")}>
      {STEPS.map((step, idx) => {
        const status = step < currentStep ? "done" : step === currentStep ? "current" : "future";
        return (
          <li key={step} className="flex items-center gap-2">
            {idx > 0 ? <span aria-hidden className="h-px w-4 bg-border" /> : null}
            <span
              data-testid={`import-step-${step}`}
              data-step-status={status}
              className={cn(
                "flex items-center gap-1 text-caption font-medium",
                status === "future" ? "text-muted-foreground" : "text-success",
                status === "current" && "font-bold",
              )}
            >
              {status === "done" ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden>{step}</span>}
              {t(STEP_LABEL_KEYS[step])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface Step1BodyProps {
  state: ImportWizardState;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilePick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEncodingChange: (encoding: CsvEncoding) => void;
  onReplaceClick: () => void;
}

function Step1Body({
  state, fileInputRef, onFilePick, onEncodingChange, onReplaceClick,
}: Step1BodyProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      {/* Always mounted (even once a file chip is showing) so "Replace"
          below can re-trigger the same input via fileInputRef. */}
      <input
        id="import-wizard-file"
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="sr-only"
        aria-label={t("importChooseFile")}
        onChange={onFilePick}
      />

      {!state.file ? (
        <label
          htmlFor="import-wizard-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-6 text-center text-body text-muted-foreground"
        >
          <span>
            {t("importChooseFile")} <span className="font-medium text-primary">{t("importChooseBrowse")}</span>
          </span>
        </label>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-body font-medium text-foreground">{state.file.name}</span>
            <span className="text-caption text-muted-foreground">
              {t("importWorkerNote", { size: formatSize(state.file.size) })}
            </span>
          </div>
          <Button
            type="button"
            variant="link"
            className="shrink-0 text-caption"
            onClick={onReplaceClick}
          >
            {t("importReplace")}
          </Button>
        </div>
      )}

      {state.file ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-medium text-foreground">{t("importEncodingLabel")}</span>
            {!state.encodingOverridden ? (
              <span className="inline-flex items-center rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-caption font-medium text-info">
                {t("importAutoDetected")}
              </span>
            ) : null}
            <div role="group" aria-label={t("importEncodingLabel")} className="ml-auto inline-flex gap-1 rounded-md border border-border p-0.5">
              <EncodingSegment
                pressed={state.encoding === "windows-1251"}
                label={t("importEncodingWindows1251")}
                onClick={() => onEncodingChange("windows-1251")}
              />
              <EncodingSegment
                pressed={state.encoding === "utf-8"}
                label={t("importEncodingUtf8")}
                onClick={() => onEncodingChange("utf-8")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-caption font-medium text-muted-foreground">{t("importPreviewLabel")}</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full font-mono text-caption">
                <thead>
                  <tr>
                    {state.headers.map((header) => (
                      <th key={header} className="border-b border-border bg-muted px-2 py-1 text-left font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Always sliced to 3, even though `state.rows` holds the
                      FULL parsed file once the operator has visited step 2
                      and come Back — this label says "first 3 rows" and
                      must stay honest regardless of how much data is
                      actually sitting in state. */}
                  {state.rows.slice(0, 3).map((row, idx) => (
                    // Static 3-row preview (no reordering/removal), so an
                    // index key is safe here.
                    <tr key={idx}>
                      {state.headers.map((header) => (
                        <td key={header} className="px-2 py-1 text-foreground">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-caption text-muted-foreground">{t("importEncodingHint")}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function EncodingSegment({ pressed, label, onClick }: { pressed: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={pressed}
      className={cn(pressed && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

// Up to 2 real, non-blank sample values for a column, scanning the full
// (post-full-parse) row set rather than just the first couple of rows —
// some columns are sparsely filled (e.g. board 3b's "Категория"/notes-style
// columns), so limiting the scan to row[0]/row[1] would show blanks for a
// column that does have real data further down the file.
function sampleValues(rows: Record<string, string>[], header: string): string[] {
  const values: string[] = [];
  for (const row of rows) {
    const value = row[header];
    if (value) values.push(value);
    if (values.length === 2) break;
  }
  return values;
}

interface Step2BodyProps {
  state: ImportWizardState;
  onMappingChange: (header: string, target: MappingTarget) => void;
}

// Board 3b — the column-mapping grid: CSV column (mono chip) -> arrow ->
// Idento field (select, + custom-name input when "Custom field" is picked)
// -> sample values. `state.mapping` is expected to already be fully
// populated (one entry per header) by the time this mounts, since
// `handleContinue` runs `computeDefaultMapping` in the same state update
// that sets `step: 2` — but a `?? unset` fallback keeps a header without an
// explicit entry from crashing the lookup rather than silently misbehaving.
function Step2Body({ state, onMappingChange }: Step2BodyProps) {
  const { t } = useTranslation();

  return (
    <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
      <div className="grid grid-cols-[minmax(0,160px)_20px_minmax(0,240px)_minmax(0,1fr)] items-start gap-x-3 gap-y-3">
        <span className="text-caption font-medium text-muted-foreground">{t("importCsvColumn")}</span>
        <span aria-hidden />
        <span className="text-caption font-medium text-muted-foreground">{t("importIdentoField")}</span>
        <span className="text-caption font-medium text-muted-foreground">{t("importSample")}</span>
        {state.headers.map((header) => (
          <MappingRow
            key={header}
            header={header}
            target={state.mapping[header] ?? { kind: "unset" }}
            samples={sampleValues(state.rows, header)}
            onChange={(target) => onMappingChange(header, target)}
          />
        ))}
      </div>
    </div>
  );
}

interface MappingRowProps {
  header: string;
  target: MappingTarget;
  samples: string[];
  onChange: (target: MappingTarget) => void;
}

// Renders as a React.Fragment of 4 grid cells (chip / arrow / field-select
// [+ custom-name input] / sample) so it slots directly into Step2Body's
// grid alongside its header row.
function MappingRow({ header, target, samples, onChange }: MappingRowProps) {
  const { t } = useTranslation();
  const isUnset = target.kind === "unset";
  const isCustom = target.kind === "custom";
  const selectValue =
    target.kind === "standard" ? target.field : target.kind === "custom" ? "custom" : target.kind === "skip" ? "skip" : "unset";

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === "skip") {
      onChange({ kind: "skip" });
    } else if (value === "custom") {
      // Pre-filled with the CSV column's own header, per the brief — the
      // operator can rename it via the text input that appears below.
      onChange({ kind: "custom", name: header });
    } else {
      onChange({ kind: "standard", field: value as StandardField });
    }
  }

  return (
    <>
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-md border px-2 py-1 font-mono text-caption",
          isUnset ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-muted text-foreground",
        )}
      >
        {header}
      </span>
      <ArrowRight aria-hidden className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1.5">
        <select
          aria-label={header}
          value={selectValue}
          onChange={handleSelectChange}
          className={cn(
            "h-9 rounded-md border bg-card px-2 text-body text-foreground",
            isUnset ? "border-dashed border-warning/40 text-warning" : "border-input",
          )}
        >
          {/* Placeholder-only option: visually reads as "Don't import" (per
              board 3b's unmapped-column treatment) while the column is
              still `unset`, but it's a DISTINCT value from the real `skip`
              option below — picking nothing yet is not the same decision as
              explicitly confirming a skip, and only the latter clears the
              must-acknowledge gate on the footer's Import button. */}
          {isUnset ? (
            <option value="unset" disabled hidden>
              {t("importDontImport")}
            </option>
          ) : null}
          {STANDARD_FIELDS.map((field) => (
            <option key={field} value={field}>
              {t(STANDARD_FIELD_LABEL_KEYS[field])}
            </option>
          ))}
          <option value="custom">{t("importCustomField")}</option>
          <option value="skip">{t("importDontImport")}</option>
        </select>
        {isCustom ? (
          <Input
            aria-label={`${t("importCustomFieldNameLabel")}: ${header}`}
            value={target.name}
            onChange={(e) => onChange({ kind: "custom", name: e.target.value })}
          />
        ) : null}
      </div>
      <div className={cn("text-caption", isUnset ? "text-warning" : "text-muted-foreground")}>
        {isUnset ? t("importUnmappedWarning") : samples.length > 0 ? samples.join(", ") : "—"}
      </div>
    </>
  );
}
