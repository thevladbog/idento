import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Progress,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { decodeBuffer, detectEncoding, type CsvEncoding } from "./encoding";
import { parseCsv } from "./parseCsv";
import {
  buildBulkPayload, buildFailedRowsCsv, chunkArray, computeDefaultMapping,
  createInitialWizardState, IMPORT_CHUNK_SIZE, mapChunkRowToAbsolute, validateMapping,
  type ImportWizardState, type MappingTarget, type RowError, type StandardField,
} from "./wizardState";
import { downloadCsv } from "../exportCsv";
import { ATTENDEES_LIST_KEY } from "../hooks";
import { $api } from "../../../shared/api/query";

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
// override, 3-row live preview), step 2 (full-file parse + column mapping
// grid, Task 12), and step 3 (chunked bulk-import submission, progress, and
// per-row error report, Task 13). Board 3c's "Fix inline" per-error action
// is deliberately descoped here to Retry/Skip/download-as-CSV — an inline
// edit-grid for a failed row's cells is a lot of surface area for marginal
// value when the CSV download already covers offline fixing (v1 honest
// scope, noted per the task brief).
export function ImportWizard({ eventId, open, onOpenChange }: ImportWizardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bulkImport = $api.useMutation("post", "/api/events/{event_id}/attendees/bulk");
  const [state, setState] = React.useState<ImportWizardState>(createInitialWizardState);
  const [isFullParsing, setIsFullParsing] = React.useState(false);
  // Fix 2 (CodeRabbit, PR #65): step 1's own busy flags, tracking a file
  // pick's `arrayBuffer()`+preview-parse and an encoding change's re-parse
  // in flight, respectively. Named to mirror step 3's isImporting/
  // isStep3Busy convention. `isFullParsing` above already covers the third
  // step-1 async op (the step 1->2 full parse) and is reused as-is.
  const [isFilePicking, setIsFilePicking] = React.useState(false);
  const [isEncodingChanging, setIsEncodingChanging] = React.useState(false);
  // Fix 3 (CodeRabbit, PR #65): set when the FULL (step 1->2) parse comes
  // back with non-empty PapaParse diagnostics (parseCsv's `errors`) — blocks
  // the step 1->2 transition and shows a validation message instead of
  // silently carrying a malformed file's garbage rows into step 2.
  const [step1ParseError, setStep1ParseError] = React.useState(false);
  // Fix 2 (CodeRabbit, PR #65): incremented every time the dialog transitions
  // closed (in the SAME `open`-driven reset effect below that already resets
  // other step-1/step-3 state). Each of handleFilePick/handleEncodingChange/
  // handleContinue captures this ref's value at the start of the function
  // (before its first await) and re-checks it after every await, before
  // every setState call — if the value has moved on, the dialog was closed
  // (and its state already reset) while that operation was still in flight,
  // so the operation abandons itself silently rather than writing stale
  // data into a session that's no longer the one it started in. Mirrors
  // isStep3Busy/importStartedRef's "don't let async work outlive its
  // session" reasoning, extended to cover step 1.
  const step1SessionRef = React.useRef(0);
  // Fix (Codex, PR #65): step1SessionRef only changes on dialog close/reopen
  // — it does NOT protect against two encoding-change clicks made in quick
  // succession within the SAME open session. If an earlier (slower) parse
  // resolves after a later (faster) one, its stale setState would win and
  // silently overwrite the encoding/preview the operator actually chose
  // last. Both EncodingSegments are now disabled for the duration of a
  // reparse (isStep1Busy/encodingChanging below), which already closes this
  // race at the only UI entry point — a disabled DOM button never dispatches
  // a click, so a genuine double-click can't reach handleEncodingChange a
  // second time before the first call settles. This token is defense-in-
  // depth for any future caller of handleEncodingChange that doesn't go
  // through those disabled buttons: incremented at the START of every call;
  // only the invocation whose captured value still matches the LATEST one
  // after its await is allowed to apply state — every earlier, now-stale
  // call is a no-op.
  const encodingChangeTokenRef = React.useRef(0);
  // Task 13: true only while a bulk-import chunk POST is actually in
  // flight (not while step 3 is merely showing settled results/errors) —
  // this flag also gates the footer's Download/Done buttons so they can't
  // appear mid-upload, and (combined with chunkFailure/retryingRows below
  // into isStep3Busy) gates the dialog's close affordance per the
  // implementation plan's explicit reconciliation decision (line 62: "not
  // dismissable mid-import ... becomes closable once all chunks settle").
  const [isImporting, setIsImporting] = React.useState(false);
  // Set only when a chunk POST itself rejects (network-level failure, not a
  // per-row error in a successful response) — tracks how many rows across
  // the not-yet-successfully-sent chunks (starting at the failed one) still
  // need sending, so "Retry remaining" can resume from exactly there.
  const [chunkFailure, setChunkFailure] = React.useState<{ nextChunkIndex: number; remainingRowCount: number } | null>(null);
  // Rows currently mid-retry (Step3Body's per-row "Retry" button) — disables
  // just that row's button rather than the whole footer while its
  // single-row re-POST is in flight.
  const [retryingRows, setRetryingRows] = React.useState<ReadonlySet<number>>(new Set());
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Guards the step-3 auto-start effect below against running twice (e.g.
  // React StrictMode's double-invoke of effects in dev) — the ref check
  // happens synchronously before any await, so only the first invocation
  // per step-3 entry ever calls runChunksFrom.
  const importStartedRef = React.useRef(false);

  // Reset to a fresh step-1 state whenever the dialog transitions closed —
  // same reset-on-close convention as AddAttendeeDialog/CreateEventDialog —
  // so reopening never resumes a stale file/preview from a previous run.
  React.useEffect(() => {
    if (open) return;
    setState(createInitialWizardState());
    setIsImporting(false);
    setChunkFailure(null);
    setRetryingRows(new Set());
    importStartedRef.current = false;
    // Fix 2: bump the session id so any step-1 async op still in flight from
    // before this close (file pick / encoding change / full parse) detects
    // the mismatch on its next check and abandons itself instead of
    // resolving into this freshly-reset state. Also reset the busy flags
    // directly — a NEW step-1 operation started after reopening will set its
    // own flag true again; the abandoned old operation is barred (by the
    // session check) from ever touching these itself.
    setIsFilePicking(false);
    setIsEncodingChanging(false);
    setIsFullParsing(false);
    setStep1ParseError(false);
    step1SessionRef.current += 1;
  }, [open]);

  // Recomputed on every mapping/full-parse change — dedup depends on
  // WHICHEVER column is currently mapped to email, so it has to be live,
  // not computed once when step 2 mounts. Stable (unchanged) for the whole
  // of step 3, since state.rows/state.mapping never change once past step 2
  // — step 3's chunking logic below relies on that stability.
  const bulkPayload = React.useMemo(
    () => buildBulkPayload(state.rows, state.mapping),
    [state.rows, state.mapping],
  );
  const totalRowsAfterDedup = bulkPayload.attendees.length;

  // Runs chunks [startIndex, chunks.length) sequentially — awaiting each
  // mutateAsync before starting the next, never Promise.all — and merging
  // each chunk's OWN contribution (its `created` count and its
  // newly-mapped errors, both read straight off that one chunk's HTTP
  // response) onto whatever importProgress/rowErrors are CURRENT in state
  // via a functional `setState` updater keyed off `prev`. This is
  // deliberate, not incidental: step 3's error table isn't gated by
  // isImporting, so a user can Skip/Retry an earlier chunk's error row
  // (each of those is already a correct functional update against `prev`)
  // WHILE a later chunk is still in flight. Fix round 4: this loop used to
  // accumulate `doneCount`/`errors` in closure-local variables across
  // iterations and write them out wholesale on each chunk's resolution —
  // which meant a later chunk's setState would silently overwrite/revert
  // whatever a concurrent Skip/Retry had just done, since that closure
  // snapshot didn't know about it. Every setState call below reads
  // `prev.importProgress`/`prev.rowErrors` instead, so it merges onto
  // whichever state is actually current at the moment it runs. Because of
  // that, this no longer needs to be told where `done`/`rowErrors` stood
  // when it started — `prev` already reflects whatever the last completed
  // chunk (or user action) left behind — so it's shared as-is by both the
  // initial step-3 entry (Task 13's brief) and "Retry remaining" after a
  // chunk-level network failure, which resumes from the same chunk index
  // rather than restarting from 0.
  async function runChunksFrom(chunks: Record<string, unknown>[][], startIndex: number) {
    setIsImporting(true);
    setChunkFailure(null);
    const total = totalRowsAfterDedup;
    for (let chunkIndex = startIndex; chunkIndex < chunks.length; chunkIndex++) {
      try {
        // Awaited inside the loop deliberately — sequential submission
        // (never Promise.all) is the whole point per the task brief.
        const response = await bulkImport.mutateAsync({
          params: { path: { event_id: eventId } },
          body: { attendees: chunks[chunkIndex], field_schema: bulkPayload.field_schema },
        });
        // This chunk's own contribution ONLY — read directly off its own
        // HTTP response, never an accumulated running total — is what's
        // safe to close over here; see the function doc comment above.
        const chunkCreated = response.created;
        // Fix 4 (CodeRabbit, PR #65): mapChunkRowToAbsolute's result is a
        // POST-DEDUP position, not the row's position in the operator's
        // actual source file — those diverge as soon as an EARLIER
        // duplicate has been removed. Translate through
        // bulkPayload.originalRowIndices (parallel to attendees/
        // dedupedRows) before it ever becomes a user-visible RowError.row.
        // The `?? postDedupPosition` fallback is defensive only — every
        // post-dedup position 1..attendees.length has a corresponding
        // entry, so it should never actually be hit.
        const chunkErrors: RowError[] = (response.errors ?? []).map((err) => {
          const postDedupPosition = mapChunkRowToAbsolute(chunkIndex, IMPORT_CHUNK_SIZE, err.row);
          return {
            row: bulkPayload.originalRowIndices[postDedupPosition - 1] ?? postDedupPosition,
            data: err.data,
            problem: err.problem,
          };
        });
        setState((prev) => ({
          ...prev,
          importProgress: { done: (prev.importProgress?.done ?? 0) + chunkCreated, total },
          rowErrors: [...(prev.rowErrors ?? []), ...chunkErrors],
        }));
      } catch {
        // Chunk-level network failure (the mutation itself rejected — not a
        // per-row error in a successful response): everything from this
        // chunk onward is un-sent. Surface it with a count and a resumable
        // "Retry remaining" affordance rather than silently losing rows.
        const remainingRowCount = chunks.slice(chunkIndex).reduce((sum, chunk) => sum + chunk.length, 0);
        setChunkFailure({ nextChunkIndex: chunkIndex, remainingRowCount });
        setIsImporting(false);
        return;
      }
    }
    setIsImporting(false);
  }

  // Auto-starts the chunked submission the moment step 3 mounts (the brief:
  // "on entering step 3 ... split payload into chunks ... POST
  // sequentially"). Guarded by importStartedRef so it only actually runs
  // once per step-3 entry (see the ref's declaration comment above).
  React.useEffect(() => {
    if (state.step !== 3) {
      importStartedRef.current = false;
      return;
    }
    if (importStartedRef.current) return;
    importStartedRef.current = true;
    const chunks = chunkArray(bulkPayload.attendees, IMPORT_CHUNK_SIZE);
    void runChunksFrom(chunks, 0);
    // bulkImport/bulkPayload/eventId/totalRowsAfterDedup are stable for the
    // duration of step 3 (rows/mapping don't change once past step 2); this
    // effect is only meant to fire on the step 1/2 -> 3 transition itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  function handleRetryRemaining() {
    if (!chunkFailure) return;
    const chunks = chunkArray(bulkPayload.attendees, IMPORT_CHUNK_SIZE);
    void runChunksFrom(chunks, chunkFailure.nextChunkIndex);
  }

  // duplicate_email/duplicate_code "Skip": the row was never created (the
  // backend rejected it as a duplicate), so this only acknowledges/dismisses
  // it from the error list — no network call, and no change to `done`
  // (re-trying a duplicate would just duplicate-error again, per the brief).
  function handleSkipRow(row: number) {
    setState((prev) => ({ ...prev, rowErrors: (prev.rowErrors ?? []).filter((error) => error.row !== row) }));
  }

  // create_failed "Retry": re-POSTs just that one row as a batch of 1
  // (same endpoint). Success removes it from the error list and increments
  // `done`; failure (still an error in the response, or the request itself
  // rejects) leaves it in the list untouched — the brief is explicit this
  // must not auto-loop, just let the user click Retry again.
  //
  // Fix 4 (CodeRabbit, PR #65): `row` is the ORIGINAL source-file row number
  // (what RowError.row now stores) — it must be translated back through
  // postDedupIndexByOriginalRow to index into bulkPayload.attendees, which
  // is still ordered/indexed by POST-DEDUP position.
  async function handleRetryRow(row: number) {
    const postDedupIndex = postDedupIndexByOriginalRow.get(row);
    const attendee = postDedupIndex !== undefined ? bulkPayload.attendees[postDedupIndex] : undefined;
    if (!attendee) return;
    setRetryingRows((prev) => new Set(prev).add(row));
    try {
      const response = await bulkImport.mutateAsync({
        params: { path: { event_id: eventId } },
        body: { attendees: [attendee], field_schema: bulkPayload.field_schema },
      });
      if (response.errors && response.errors.length > 0) {
        const problem = response.errors[0].problem;
        setState((prev) => ({
          ...prev,
          rowErrors: (prev.rowErrors ?? []).map((error) => (error.row === row ? { ...error, problem } : error)),
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        importProgress: prev.importProgress
          ? { done: prev.importProgress.done + response.created, total: prev.importProgress.total }
          : prev.importProgress,
        rowErrors: (prev.rowErrors ?? []).filter((error) => error.row !== row),
      }));
    } catch {
      // Network failure on a single-row retry — leave the row in the list.
    } finally {
      setRetryingRows((prev) => {
        const next = new Set(prev);
        next.delete(row);
        return next;
      });
    }
  }

  // Downloads the ORIGINAL source rows (dedupedRows, header-keyed — NOT the
  // field_schema-keyed `attendees` objects) for every row still in the error
  // list, so an operator can fix them offline and re-import just those.
  //
  // Fix 4 (CodeRabbit, PR #65): `error.row` is now the ORIGINAL source-file
  // row number, not a post-dedup position — translate it back through
  // postDedupIndexByOriginalRow to index into dedupedRows, which is still
  // ordered/indexed by POST-DEDUP position.
  function handleDownloadErrors() {
    const errors = state.rowErrors ?? [];
    if (errors.length === 0) return;
    const rows = errors
      .map((error) => {
        const postDedupIndex = postDedupIndexByOriginalRow.get(error.row);
        return postDedupIndex !== undefined ? bulkPayload.dedupedRows[postDedupIndex] : undefined;
      })
      .filter((row): row is Record<string, string> => row !== undefined);
    const csv = buildFailedRowsCsv(state.headers, rows);
    downloadCsv(csv, "import-errors.csv");
  }

  // Shared by handleDone (the explicit terminal CTA) and
  // handleDialogOpenChange below (X/Escape/outside-click once step 3 is
  // genuinely closable) so the invalidation only lives in one place —
  // fixing a bug where only the "Done" button ever triggered it.
  function invalidateAttendeesList() {
    void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
  }

  // The wizard's explicit terminal CTA once step 3 has settled. Invalidates
  // the attendees list so the table reflects the just-imported rows.
  function handleDone() {
    invalidateAttendeesList();
    onOpenChange(false);
  }

  // Wraps the raw `onOpenChange` prop that <Dialog> hands to Radix's own
  // X/Escape/outside-click dismiss paths (DialogContent's close button, and
  // onEscapeKeyDown/onPointerDownOutside/onInteractOutside below all call
  // through to this same prop when not prevented). Those paths bypass
  // handleDone entirely, so without this wrapper a user who dismisses step 3
  // via X/Escape/outside-click instead of clicking "Done" would close the
  // wizard WITHOUT ever invalidating the list — violating the plan's "close
  // after success invalidates the list". isStep3Busy (below) already blocks
  // these dismiss paths while genuinely busy, so in practice this only ever
  // fires once settled — but invalidating unconditionally on any step-3
  // close is still correct even for an edge case where step 3 was somehow
  // reached with nothing sent yet (an unchanged list just means one harmless
  // extra refetch).
  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen && state.step === 3) {
      invalidateAttendeesList();
    }
    onOpenChange(nextOpen);
  }

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

  // Fix 2 (CodeRabbit, PR #65): `session` is captured BEFORE the first
  // `await`, then re-checked after every subsequent `await` and before every
  // `setState` — if the dialog was closed (and reset) while this was in
  // flight, `step1SessionRef.current` has moved on and this bails out
  // silently rather than repopulating a "fresh" wizard with a previous
  // session's file/preview. `isFilePicking` is only ever cleared here when
  // the session still matches; an abandoned run leaves it alone (the reset
  // effect already cleared it on close, and a new pick sets/clears its own).
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same filename again still fires onChange.
    e.target.value = "";
    if (!file) return;
    const session = step1SessionRef.current;
    setIsFilePicking(true);
    try {
      const buffer = await file.arrayBuffer();
      if (step1SessionRef.current !== session) return;
      const encoding = detectEncoding(buffer);
      const { rows, headers } = await loadPreview(buffer, encoding);
      if (step1SessionRef.current !== session) return;
      setState((prev) => ({
        ...prev,
        file,
        buffer,
        encoding,
        encodingOverridden: false,
        rows,
        headers,
      }));
      setStep1ParseError(false);
    } finally {
      if (step1SessionRef.current === session) setIsFilePicking(false);
    }
  }

  // Same session-guard pattern as handleFilePick above.
  async function handleEncodingChange(encoding: CsvEncoding) {
    if (!state.buffer) return;
    const session = step1SessionRef.current;
    const buffer = state.buffer;
    // Fix (Codex, PR #65): claim the latest-call token BEFORE the await, so
    // an earlier call that resolves later (rapid double-click on a large
    // file) can detect it's been superseded and skip applying its stale
    // result — see the ref's own doc comment above.
    const token = (encodingChangeTokenRef.current += 1);
    setIsEncodingChanging(true);
    try {
      // Always re-decode + re-parse (cheap: 3 rows), even if `encoding`
      // already matches — clicking a segment always marks the choice as an
      // explicit user override, whether or not it actually changes the value.
      const { rows, headers } = await loadPreview(buffer, encoding);
      if (step1SessionRef.current !== session) return;
      if (encodingChangeTokenRef.current !== token) return;
      setState((prev) => ({ ...prev, encoding, encodingOverridden: true, rows, headers }));
    } finally {
      if (step1SessionRef.current === session && encodingChangeTokenRef.current === token) {
        setIsEncodingChanging(false);
      }
    }
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
  // Fix 2: same session-guard pattern as handleFilePick/handleEncodingChange.
  // Fix 3: a non-empty `errors` from the FULL parse (malformed rows PapaParse
  // itself flagged — inconsistent column counts, quote failures, etc.) means
  // `rows` may contain garbage; blocks the step 1->2 transition and surfaces
  // `step1ParseError` instead of silently carrying that into step 2. The
  // 3-row preview parse (loadPreview) deliberately doesn't get this
  // treatment — it's just a preview, not the data that gets imported.
  async function handleContinue() {
    if (!state.buffer) return;
    const session = step1SessionRef.current;
    setIsFullParsing(true);
    try {
      const text = decodeBuffer(state.buffer, state.encoding);
      const { rows, headers, errors } = await parseCsv(text, { worker: true });
      if (step1SessionRef.current !== session) return;
      if (errors.length > 0) {
        setStep1ParseError(true);
        return;
      }
      setStep1ParseError(false);
      setState((prev) => ({
        ...prev,
        rows,
        headers,
        mapping: computeDefaultMapping(headers),
        step: 2,
      }));
    } finally {
      if (step1SessionRef.current === session) setIsFullParsing(false);
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

  // The step 2->3 transition trigger. Sets importProgress to "0 of N" and
  // clears rowErrors synchronously with the step flip, so step 3's first
  // render already shows a real (not undefined) progress bar — the actual
  // chunked submission then starts via the step-3 auto-start effect above.
  function handleImportRows() {
    setState((prev) => ({ ...prev, step: 3, importProgress: { done: 0, total: totalRowsAfterDedup }, rowErrors: [] }));
  }

  const canContinue = Boolean(state.file) && state.rows.length > 0;

  const hasUnsetColumn = state.headers.some(
    (header) => (state.mapping[header] ?? { kind: "unset" as const }).kind === "unset",
  );

  // Fix 1 (CodeRabbit, PR #65): recomputed on every mapping change — the
  // problem-header list (blank custom names / duplicate target keys) that
  // would otherwise let buildBulkPayload silently drop data via
  // last-write-wins. Gates the "Import N rows" button alongside
  // hasUnsetColumn and drives the mapping grid's amber highlighting for the
  // offending columns.
  const mappingProblems = React.useMemo(() => validateMapping(state.mapping), [state.mapping]);
  const hasMappingProblems = mappingProblems.length > 0;

  // Fix 4 (CodeRabbit, PR #65): reverse lookup from a row's ORIGINAL
  // 1-based source-file position (what RowError.row now stores, for
  // display) back to its position in the post-dedup attendees/dedupedRows
  // arrays (what's actually needed to index into them). Built once per
  // bulkPayload change, reused by both the per-row Retry handler and the
  // failed-rows CSV download.
  const postDedupIndexByOriginalRow = React.useMemo(() => {
    const map = new Map<number, number>();
    bulkPayload.originalRowIndices.forEach((originalRow, index) => {
      map.set(originalRow, index);
    });
    return map;
  }, [bulkPayload]);

  // Fix 2 (CodeRabbit, PR #65): genuine "still busy" for step 1, mirroring
  // isStep3Busy's naming/reasoning below — covers every in-flight step-1
  // async op (file pick, encoding-change re-parse, full parse) so the
  // dialog's dismiss paths and the step-1 footer's Cancel button can be
  // gated the same way step 3 already gates its own busy window.
  const isStep1Busy = isFilePicking || isEncodingChanging || isFullParsing;

  // Genuine "still busy" for step 3, per the plan's explicit reconciliation
  // decision (line 62): "not dismissable mid-import ... becomes closable
  // once all chunks settle" — NOT unconditional for the whole step. Covers
  // every kind of in-flight server work step 3 can have outstanding: the
  // main chunk loop (isImporting), an un-sent-chunk "Retry remaining" POST
  // (also isImporting, since runChunksFrom sets it), and any per-row "Retry"
  // in flight (retryingRows). Once none of these are true, step 3 becomes
  // closable via X/Escape/outside-click too, not just the explicit "Done"
  // button.
  //
  // Fix (Codex, PR #65): a persistent chunk-level failure (e.g. the backend
  // rejecting every retry with a 403 attendees_per_event limit) used to be
  // treated as "busy" indefinitely — chunkFailure only ever clears via a
  // SUCCESSFUL resend, so a failure that can never succeed left the dialog
  // permanently undismissable (hideClose, blocked Escape/outside-click, and
  // — see the footer render condition below — literally no footer at all),
  // trapping the operator until a page reload. A SETTLED failure (isImporting
  // false) is not "busy": the operator must be able to close and keep
  // whatever already succeeded, using "Retry remaining" only while they
  // choose to.
  const isStep3Busy = isImporting || retryingRows.size > 0;

  // Blocks Escape/outside-click dismissal while EITHER step's busy flag is
  // genuinely set, scoped to the CURRENT step so a busy step-1 op never
  // blocks a step-3 dismissal (impossible anyway, since they're different
  // steps) and vice versa. Extends the step-3-only precedent (Fix 2) to
  // cover step 1 the same way, rather than hardcoding step 3.
  function preventDialogDismiss(e: Event) {
    if (state.step === 1 && isStep1Busy) e.preventDefault();
    if (state.step === 3 && isStep3Busy) e.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      {/* Board widths: 3a (step 1) = 760px, 3b/3c (steps 2-3) = 860px card. */}
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        hideClose={(state.step === 1 && isStep1Busy) || (state.step === 3 && isStep3Busy)}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
        className={cn("max-w-[760px]", state.step !== 1 && "max-w-[860px]")}
      >
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <StepIndicator currentStep={state.step} />
        </DialogHeader>

        {state.step === 1 ? (
          <Step1Body
            state={state}
            fileInputRef={fileInputRef}
            parseError={step1ParseError}
            encodingChanging={isEncodingChanging}
            onFilePick={handleFilePick}
            onEncodingChange={handleEncodingChange}
            onReplaceClick={handleReplaceClick}
          />
        ) : state.step === 2 ? (
          <Step2Body state={state} mappingProblems={mappingProblems} onMappingChange={handleMappingChange} />
        ) : (
          <Step3Body
            state={state}
            chunkFailure={chunkFailure}
            retryingRows={retryingRows}
            onRetryRemaining={handleRetryRemaining}
            onSkipRow={handleSkipRow}
            onRetryRow={handleRetryRow}
          />
        )}

        <DialogFooter>
          {state.step === 1 ? (
            <>
              <Button type="button" variant="outline" disabled={isStep1Busy} onClick={() => onOpenChange(false)}>
                {t("createEventCancel")}
              </Button>
              <Button type="button" disabled={!canContinue || isStep1Busy} onClick={handleContinue}>
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
              <Button type="button" disabled={hasUnsetColumn || hasMappingProblems} onClick={handleImportRows}>
                {t("importRowsCta", { count: totalRowsAfterDedup })}
              </Button>
            </>
          ) : !isImporting ? (
            // Settled — either every chunk succeeded/was retried to
            // completion, OR a chunk-level failure remains but nothing is
            // actively in flight (Fix, Codex PR #65: previously gated on
            // `!chunkFailure` too, which meant a PERSISTENT failure — one
            // "Retry remaining" can never fix — hid this whole footer
            // forever, leaving no way to close the dialog). The board's
            // step-3 footer: left download link (only when errors remain),
            // right the terminal "Done" CTA. No Cancel is ever offered here;
            // Step3Body's own "Retry remaining" banner (still visible above)
            // stays available for as long as chunkFailure is set.
            <>
              {(state.rowErrors?.length ?? 0) > 0 ? (
                <Button type="button" variant="link" className="sm:mr-auto" onClick={handleDownloadErrors}>
                  {t("importDownloadErrors", { count: state.rowErrors?.length ?? 0 })}
                </Button>
              ) : null}
              {/* Gated on the SAME isStep3Busy the dismiss paths use (fix
                  round 2), not just the outer !isImporting the footer
                  itself renders on. The chunk-import phase can
                  settle (footer renders) while a per-row "Retry" is still
                  in flight (retryingRows.size > 0) — without this, clicking
                  Done mid-retry ran handleDone() immediately: it
                  invalidates the attendees list and tears the wizard down
                  BEFORE the retried row exists server-side, and when that
                  retry later resolves into a reset wizard it never
                  re-invalidates, so the recovered row silently never shows
                  up in the list. Disabling (not hiding) Done specifically —
                  rather than folding retryingRows into the footer's own
                  render condition — keeps the Download-errors link (which
                  has no equivalent race; it only reads the already-settled
                  rowErrors/dedupedRows snapshot synchronously) usable while
                  a retry is pending. */}
              <Button type="button" disabled={isStep3Busy} onClick={handleDone}>
                {t("importDone", { count: state.importProgress?.done ?? 0 })}
              </Button>
            </>
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
  // Fix 3 (CodeRabbit, PR #65): true once the full (step 1->2) parse has
  // come back with non-empty PapaParse diagnostics — renders a validation
  // message and keeps the operator on step 1 instead of silently carrying a
  // malformed file's garbage rows forward.
  parseError: boolean;
  // Fix (Codex, PR #65): disables both encoding segments while a reparse is
  // in flight — belt-and-suspenders alongside encodingChangeTokenRef's
  // ordering guard: fewer rapid double-clicks even get a chance to race.
  encodingChanging: boolean;
  onFilePick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEncodingChange: (encoding: CsvEncoding) => void;
  onReplaceClick: () => void;
}

function Step1Body({
  state, fileInputRef, parseError, encodingChanging, onFilePick, onEncodingChange, onReplaceClick,
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
                disabled={encodingChanging}
                onClick={() => onEncodingChange("windows-1251")}
              />
              <EncodingSegment
                pressed={state.encoding === "utf-8"}
                label={t("importEncodingUtf8")}
                disabled={encodingChanging}
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

          {parseError ? <p className="text-caption text-destructive">{t("importParseErrorWarning")}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function EncodingSegment({
  pressed, label, disabled, onClick,
}: { pressed: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={pressed}
      disabled={disabled}
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
  // Fix 1 (CodeRabbit, PR #65): header names flagged by validateMapping
  // (blank custom name, or a target key colliding with another header's) —
  // drives both the summary warning below and each offending row's amber
  // highlighting.
  mappingProblems: string[];
  onMappingChange: (header: string, target: MappingTarget) => void;
}

// Board 3b — the column-mapping grid: CSV column (mono chip) -> arrow ->
// Idento field (select, + custom-name input when "Custom field" is picked)
// -> sample values. `state.mapping` is expected to already be fully
// populated (one entry per header) by the time this mounts, since
// `handleContinue` runs `computeDefaultMapping` in the same state update
// that sets `step: 2` — but a `?? unset` fallback keeps a header without an
// explicit entry from crashing the lookup rather than silently misbehaving.
function Step2Body({ state, mappingProblems, onMappingChange }: Step2BodyProps) {
  const { t } = useTranslation();
  const mappingProblemSet = React.useMemo(() => new Set(mappingProblems), [mappingProblems]);

  return (
    <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
      {/* Fix 1: summary warning shown whenever ANY column has a blank
          custom name or collides with another column's target key — the
          per-row amber highlighting below (reusing the unset-column
          treatment) identifies exactly which ones. */}
      {mappingProblemSet.size > 0 ? (
        <p className="text-caption font-medium text-warning">{t("importDuplicateMappingWarning")}</p>
      ) : null}
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
            isInvalid={mappingProblemSet.has(header)}
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
  // Fix 1 (CodeRabbit, PR #65): true when this header's mapping is flagged
  // by validateMapping — reuses the same amber warning treatment `isUnset`
  // already gets, since both are "this column needs the operator's
  // attention before Import" states.
  isInvalid: boolean;
  onChange: (target: MappingTarget) => void;
}

// Renders as a React.Fragment of 4 grid cells (chip / arrow / field-select
// [+ custom-name input] / sample) so it slots directly into Step2Body's
// grid alongside its header row.
function MappingRow({ header, target, samples, isInvalid, onChange }: MappingRowProps) {
  const { t } = useTranslation();
  const isUnset = target.kind === "unset";
  const isCustom = target.kind === "custom";
  const hasWarning = isUnset || isInvalid;
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
          hasWarning ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-muted text-foreground",
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
            hasWarning ? "border-dashed border-warning/40 text-warning" : "border-input",
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
      <div className={cn("text-caption", hasWarning ? "text-warning" : "text-muted-foreground")}>
        {isUnset
          ? t("importUnmappedWarning")
          : isInvalid
            ? t("importDuplicateOrBlankMapping")
            : samples.length > 0
              ? samples.join(", ")
              : "—"}
      </div>
    </>
  );
}

// Switches BulkRowError's stable problem code to its localized description
// (board 3c's per-row error text). Falls back to the raw code for a problem
// string this frontend doesn't recognize yet, rather than crashing — see
// RowError's own doc comment in wizardState.ts.
const PROBLEM_LABEL_KEYS: Record<string, string> = {
  duplicate_email: "importProblemDuplicateEmail",
  duplicate_code: "importProblemDuplicateCode",
  create_failed: "importProblemCreateFailed",
};

// duplicate_* rows get "Skip" (acknowledge, no retry — re-sending a
// duplicate just duplicate-errors again); create_failed gets "Retry"
// (re-POST that one row — a transient/server-side failure may well succeed
// the second time).
function isDuplicateProblem(problem: string): boolean {
  return problem === "duplicate_email" || problem === "duplicate_code";
}

interface Step3BodyProps {
  state: ImportWizardState;
  chunkFailure: { nextChunkIndex: number; remainingRowCount: number } | null;
  retryingRows: ReadonlySet<number>;
  onRetryRemaining: () => void;
  onSkipRow: (row: number) => void;
  onRetryRow: (row: number) => void;
}

// Board 3c — progress bar, amber "needs attention" banner, per-row error
// table. `state.importProgress`/`state.rowErrors` are set synchronously with
// the step 2->3 transition (see handleImportRows above), so they're never
// undefined by the time this actually renders, but the `?? ` fallbacks below
// keep the component defensively correct if that invariant ever changes.
function Step3Body({ state, chunkFailure, retryingRows, onRetryRemaining, onSkipRow, onRetryRow }: Step3BodyProps) {
  const { t } = useTranslation();
  const done = state.importProgress?.done ?? 0;
  const total = state.importProgress?.total ?? 0;
  const errors = state.rowErrors ?? [];
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="flex max-h-[420px] flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-body font-bold text-foreground">{t("importProgress", { done, total })}</span>
          <span className="font-mono text-caption text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={done} max={total} />
      </div>

      {chunkFailure ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <p className="text-caption text-warning">
            {t("importChunkFailed", { count: chunkFailure.remainingRowCount })}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onRetryRemaining}>
            {t("importRetryRemaining")}
          </Button>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <>
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <p className="text-caption font-bold text-warning">{t("importNeedsAttention", { count: errors.length })}</p>
            <p className="text-caption text-warning">{t("importValidCommitted")}</p>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-caption">
              <thead>
                <tr className="bg-muted">
                  <th className="border-b border-border px-2 py-1 text-left font-medium">{t("importColRow")}</th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">{t("importColData")}</th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">{t("importColProblem")}</th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {errors.map((error) => (
                  <ErrorRow
                    key={error.row}
                    error={error}
                    retrying={retryingRows.has(error.row)}
                    onSkip={onSkipRow}
                    onRetry={onRetryRow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ErrorRow({
  error, retrying, onSkip, onRetry,
}: {
  error: RowError;
  retrying: boolean;
  onSkip: (row: number) => void;
  onRetry: (row: number) => void;
}) {
  const { t } = useTranslation();
  const problemLabelKey = PROBLEM_LABEL_KEYS[error.problem];
  return (
    <tr>
      <td className="border-b border-border px-2 py-1 font-mono text-foreground">{error.row}</td>
      <td className="border-b border-border px-2 py-1 text-foreground">{error.data || "—"}</td>
      <td className="border-b border-border px-2 py-1 text-destructive">
        {problemLabelKey ? t(problemLabelKey) : error.problem}
      </td>
      <td className="border-b border-border px-2 py-1 text-right">
        {isDuplicateProblem(error.problem) ? (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onSkip(error.row)}>
            {t("importSkipRow")}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={retrying} onClick={() => onRetry(error.row)}>
            {t("importRetryRow")}
          </Button>
        )}
      </td>
    </tr>
  );
}
