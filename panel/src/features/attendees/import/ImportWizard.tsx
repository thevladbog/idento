import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@idento/ui";
import { Check } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { decodeBuffer, detectEncoding, type CsvEncoding } from "./encoding";
import { parseCsv } from "./parseCsv";
import { createInitialWizardState, type ImportWizardState } from "./wizardState";

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
// step indicator) plus step 1's body (file pick, encoding auto-detect with
// override, 3-row live preview). Steps 2-3 (Tasks 12-13) are reachable via
// Continue but only render a placeholder body here — this task's job is the
// shell + step 1 + provably-wired step navigation, not the later screens.
export function ImportWizard({ eventId, open, onOpenChange }: ImportWizardProps) {
  void eventId; // Not read yet — wired once Task 13 actually submits the import.
  const { t } = useTranslation();
  const [state, setState] = React.useState<ImportWizardState>(createInitialWizardState);
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

  function handleContinue() {
    setState((prev) => ({ ...prev, step: 2 }));
  }

  const canContinue = Boolean(state.file) && state.rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("workspaceDialogClose")} className="max-w-[760px]">
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
        ) : (
          <p className="text-body text-muted-foreground">{t("placeholderComingSoon")}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("createEventCancel")}
          </Button>
          {state.step === 1 ? (
            <Button type="button" disabled={!canContinue} onClick={handleContinue}>
              {t("importContinueColumns")}
            </Button>
          ) : null}
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
          <button
            type="button"
            className="shrink-0 text-caption font-medium text-primary underline-offset-4 hover:underline"
            onClick={onReplaceClick}
          >
            {t("importReplace")}
          </button>
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
                  {state.rows.map((row, idx) => (
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
