import { Button, ConfirmDialog, Skeleton } from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { BadgeCanvas } from "./BadgeCanvas";
import { editorReducer, initialEditorState } from "./editorState";
import { ElementsPane } from "./ElementsPane";
import { useBadgeTemplate } from "./hooks";
import { PropertiesPane } from "./PropertiesPane";
import { SaveStatePill } from "./SaveStatePill";
import { parseTemplateDoc, serializeTemplateDoc } from "./templateTypes";
import { useSaveTemplate } from "./useSaveTemplate";
import { ApiError } from "../../shared/api/ApiError";
import { $api } from "../../shared/api/query";

// Same rationale as AttendeesPage.tsx / ZonesPage.tsx / StaffPage.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/badge");

// Board 4a — the badge editor's route/page shell (P3.1 Task 6, save model
// wired in Task 10). Owns:
//  - the editor-local top bar (title, the save-state pill, the Save button,
//    + the right-aligned "Test print" / "ZPL preview" actions, both locked
//    with the P2.2 disabled-Button+Lock idiom until P3.2 wires them up);
//  - the conflict banner (below the top bar) and its two ConfirmDialogs;
//  - the three-pane grid hosting the Elements / Canvas / Properties regions
//    (Tasks 7-9 replace these labeled placeholders with the real panes);
//  - the editor's document-state reducer (Task 5), seeded here from
//    `useBadgeTemplate`'s query once it resolves — Tasks 7-12 consume
//    `state`/`dispatch` via props only, never re-deriving them from the
//    query themselves;
//  - the save mutation's orchestration (Task 10): dispatching "saved" /
//    "load", the conflict state machine, and keeping `originalRawRef` in
//    sync — the mutation call itself (and its unconditional
//    BADGE_TEMPLATE_KEY/READINESS_KEY invalidation) lives in
//    useSaveTemplate.ts, the ONE home for it.
//
// Loading -> Skeleton panes. Fetch error -> `badgeLoadError` copy (distinct
// from the empty-state copy below) + a retry action. `template: null` (the
// event has never had one saved) -> `parseTemplateDoc(null)`'s doc defaults
// (90mm x 55mm @ 300dpi, no elements) flow into the reducer like any other
// doc, and the canvas region shows the §4 empty-state guidance for as long
// as `state.doc.elements` stays empty — this is deliberately keyed off the
// elements array, not off `template === null`, so the SAME guidance also
// covers an already-saved-but-still-empty template, and disappears the
// moment Task 7/8 dispatch the first "add".
export function BadgeEditorPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const templateQuery = useBadgeTemplate(eventId);
  // Same fetch EventSettingsPage.tsx uses to get `event` — the Elements
  // pane needs `field_schema` to tell a recognized binding from an
  // orphaned one (bindings.ts's bindingOptions). Deliberately NOT gated on:
  // the pane just falls back to `[]` (standard bindings only) until this
  // resolves or if it errors, rather than blocking the whole editor shell
  // on a second query the way the template load already is.
  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });
  const fieldSchema = eventQuery.data?.field_schema ?? [];

  const [state, dispatch] = React.useReducer(
    editorReducer,
    undefined,
    () => initialEditorState(parseTemplateDoc(null), 0),
  );

  // The raw `template` value the CURRENT doc was loaded from. Task 10's
  // save must serialize against THIS snapshot (serializeTemplateDoc's
  // `originalRaw`), and refresh it on successful save/conflict-reload —
  // never against a later `templateQuery.data.template`, which a
  // background refetch can advance past the loaded baseline (mispairing
  // per-element extras while the version check 409s). Captured at the
  // same moment "load" is dispatched so the doc/version/raw triple can
  // never drift apart.
  const originalRawRef = React.useRef<unknown>(null);

  // Which event's template has already been loaded into the reducer. This
  // single piece of state does TWO jobs:
  //  1. (Task 6's original job, previously a plain `initializedRef` boolean
  //     ref) stops a background refetch of the SAME event's badge-template
  //     query (window refocus, or a BADGE_TEMPLATE_KEY invalidation after
  //     another operator's save) from re-dispatching "load" and clobbering
  //     in-progress edits (doc, dirty, selectedId all reset) — the effect
  //     below still short-circuits via `if (initialized) return`.
  //  2. (Task 10's job) gives Save a REACTIVE, per-render signal for
  //     whether load-initialization has completed for the CURRENT event.
  //     Comparing `initializedForEventId === eventId` recomputes to `false`
  //     on the very FIRST render after an event navigation — before any
  //     effect has run — unlike a plain ref (which only flips via a LATER
  //     effect, one render too late): between an event navigation and the
  //     new event's query resolving, `state.doc` (and `state.dirty`) still
  //     hold the OLD event's data, so Save must stay disabled for that
  //     whole window, not just until the next effect flush.
  const [initializedForEventId, setInitializedForEventId] = React.useState<string | null>(null);
  const initialized = initializedForEventId === eventId;

  React.useEffect(() => {
    if (initialized) return;
    if (!templateQuery.isSuccess) return;
    originalRawRef.current = templateQuery.data.template;
    dispatch({
      type: "load",
      doc: parseTemplateDoc(templateQuery.data.template),
      version: templateQuery.data.version,
    });
    setInitializedForEventId(eventId);
  }, [eventId, initialized, templateQuery.isSuccess, templateQuery.data]);

  // --- Save model (Task 10) ---------------------------------------------
  const saveTemplate = useSaveTemplate(eventId);
  // Set on an ApiError.status === 409 (stale version) from the save PUT;
  // cleared once the Reload or Overwrite resolution succeeds. `state.dirty`
  // stays true underneath this the whole time (a 409 never dispatches
  // "saved"), which is exactly why SaveStatePill's priority order checks
  // `conflict` before `dirty`.
  const [conflict, setConflict] = React.useState(false);
  // A non-409 save failure (5xx, network error, ...) shows this inline line
  // instead — `state.dirty` is untouched (no "saved" dispatch), so the pill
  // itself falls back to its normal "Unsaved changes" reading.
  const [saveErrorVisible, setSaveErrorVisible] = React.useState(false);
  const [reloadDialogOpen, setReloadDialogOpen] = React.useState(false);
  const [overwriteDialogOpen, setOverwriteDialogOpen] = React.useState(false);
  // Both conflict-resolution paths do a GET refetch before they're done
  // (Reload always; Overwrite to re-derive `current_version` — see below),
  // and neither of those refetches makes `saveTemplate.isPending` true (it's
  // a different query, not this mutation). These flags extend "busy" to
  // cover that refetch window too, so the exhaustive busy-gating rule holds
  // for the WHOLE resolution, not just the PUT sliver of it.
  const [isReloading, setIsReloading] = React.useState(false);
  const [isOverwriting, setIsOverwriting] = React.useState(false);
  // Per-dialog failure flags (review Minor 1): while a ConfirmDialog is
  // open it OCCLUDES the page-level inline error line behind the modal
  // overlay, so a failed resolution must surface its reason INSIDE the
  // dialog, right next to the re-enabled confirm button. Cleared when the
  // dialog is (re)opened from the banner and at the start of each confirm
  // attempt, so a retry doesn't show a stale error while in flight.
  const [reloadFailed, setReloadFailed] = React.useState(false);
  const [overwriteFailed, setOverwriteFailed] = React.useState(false);
  const busy = saveTemplate.isPending || isReloading || isOverwriting;
  const saveDisabled = !initialized || !state.dirty || saveTemplate.isPending || conflict;

  // Review Minor 2: none of the save-flow UI state above is meaningful for
  // any event other than the one it was produced on — a lingering conflict
  // banner / save-error line / open confirm dialog from the previous event
  // would misreport the NEXT event's editor state. Reset it all whenever
  // the target event changes (the reducer itself is re-seeded by the load
  // effect above; this covers the save-model state the reducer doesn't own).
  React.useEffect(() => {
    setConflict(false);
    setSaveErrorVisible(false);
    setReloadDialogOpen(false);
    setOverwriteDialogOpen(false);
    setReloadFailed(false);
    setOverwriteFailed(false);
  }, [eventId]);

  function handleSave() {
    if (saveDisabled) return;
    setSaveErrorVisible(false);
    const template = serializeTemplateDoc(state.doc, originalRawRef.current);
    saveTemplate.mutate(
      { params: { path: { id: eventId } }, body: { template, version: state.version } },
      {
        onSuccess: (data) => {
          // Refresh the snapshot to the exact object just PUT — never to a
          // later `templateQuery.data.template` (see originalRawRef above).
          originalRawRef.current = template;
          dispatch({ type: "saved", version: data.version, savedAt: new Date().toISOString() });
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setConflict(true);
          } else {
            setSaveErrorVisible(true);
          }
        },
      },
    );
  }

  async function handleReloadConfirm() {
    if (busy) return;
    setIsReloading(true);
    setReloadFailed(false);
    try {
      const result = await templateQuery.refetch();
      // `result.isError` MUST be checked, not just `!result.data`: this
      // query has already succeeded once (that's how the editor loaded), and
      // react-query RETAINS the last-successful `data` when a refetch fails
      // (status flips to 'error', data stays stale). A bare `!result.data`
      // check would mistake that retained STALE doc for the server's current
      // version — loading old data, clearing the conflict, and silently
      // swallowing the failure. Instead: stay in conflict, keep the dialog
      // open, and surface the error inside it so the user can retry/cancel.
      if (result.isError || !result.data) {
        setReloadFailed(true);
        return;
      }
      originalRawRef.current = result.data.template;
      dispatch({ type: "load", doc: parseTemplateDoc(result.data.template), version: result.data.version });
      setConflict(false);
      setReloadDialogOpen(false);
    } finally {
      setIsReloading(false);
    }
  }

  async function handleOverwriteConfirm() {
    if (busy) return;
    setIsOverwriting(true);
    setOverwriteFailed(false);
    try {
      // The 409 that set `conflict` carried a `current_version` in its
      // response BODY, but http.ts's `errors` middleware only keeps
      // status/code/message on the thrown ApiError (see its `onResponse`
      // middleware) — the body itself is never retained. Re-deriving the
      // current version via a fresh GET, as the task brief directs, instead
      // of threading the 409 body through. If the refetch itself fails,
      // falling back to the stale `state.version` just re-produces a 409
      // (conflict stays, banner stays) rather than silently doing nothing.
      const result = await templateQuery.refetch();
      const currentVersion = result.data?.version ?? state.version;
      const template = serializeTemplateDoc(state.doc, originalRawRef.current);
      saveTemplate.mutate(
        { params: { path: { id: eventId } }, body: { template, version: currentVersion } },
        {
          onSuccess: (data) => {
            originalRawRef.current = template;
            dispatch({ type: "saved", version: data.version, savedAt: new Date().toISOString() });
            setConflict(false);
            setOverwriteDialogOpen(false);
          },
          onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
              // Someone saved AGAIN between our refetch and this retry —
              // stay in conflict so the user can see the banner and retry.
              setConflict(true);
            } else {
              // In-dialog (the page-level line renders behind the open
              // modal) AND page-level, so the reason stays visible if the
              // user then cancels out of the dialog.
              setOverwriteFailed(true);
              setSaveErrorVisible(true);
            }
          },
        },
      );
    } finally {
      setIsOverwriting(false);
    }
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <h2 className="text-page-title">{t("badgeTitle")}</h2>
        <div className="flex-1" />
        <SaveStatePill dirty={state.dirty} isPending={saveTemplate.isPending} conflict={conflict} savedAt={state.savedAt} />
        <Button type="button" onClick={handleSave} disabled={saveDisabled}>
          {t("badgeSave")}
        </Button>
        <Button type="button" variant="outline" disabled aria-disabled="true">
          <Lock aria-hidden className="size-4" />
          {t("badgeTestPrintLocked")}
        </Button>
        <Button type="button" variant="outline" disabled aria-disabled="true">
          <Lock aria-hidden className="size-4" />
          {t("badgeZplPreviewLocked")}
        </Button>
      </div>

      {saveErrorVisible ? <p className="text-body text-destructive">{t("badgeSaveError")}</p> : null}

      {conflict ? (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-body text-destructive">{t("badgeConflictBody")}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReloadFailed(false);
                setReloadDialogOpen(true);
              }}
            >
              {t("badgeConflictReload")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setOverwriteFailed(false);
                setOverwriteDialogOpen(true);
              }}
            >
              {t("badgeConflictOverwrite")}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={reloadDialogOpen}
        onOpenChange={(open) => {
          if (!open && busy) return;
          setReloadDialogOpen(open);
        }}
        title={t("badgeConflictReloadTitle")}
        // Spans, not nested <p>s: DialogDescription renders a <p>, which
        // only allows phrasing content. `badgeLoadError` is the same honest
        // copy the never-loaded page state uses — here it means the reload's
        // own refetch failed (conflict intact, nothing was replaced).
        description={
          <>
            {t("badgeConflictReloadBody")}
            {reloadFailed ? <span className="mt-2 block text-destructive">{t("badgeLoadError")}</span> : null}
          </>
        }
        confirmLabel={t("badgeConflictReloadConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        confirmDisabled={busy}
        onConfirm={() => void handleReloadConfirm()}
      />
      <ConfirmDialog
        open={overwriteDialogOpen}
        onOpenChange={(open) => {
          if (!open && busy) return;
          setOverwriteDialogOpen(open);
        }}
        title={t("badgeConflictOverwriteTitle")}
        description={
          <>
            {t("badgeConflictOverwriteBody")}
            {overwriteFailed ? <span className="mt-2 block text-destructive">{t("badgeSaveError")}</span> : null}
          </>
        }
        confirmLabel={t("badgeConflictOverwriteConfirm")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        confirmDisabled={busy}
        onConfirm={() => void handleOverwriteConfirm()}
      />

      {templateQuery.isLoading ? (
        <div className="grid flex-1 grid-cols-[240px_1fr_280px] gap-4">
          <Skeleton className="h-full min-h-[320px] w-full" data-testid="badge-pane-skeleton" />
          <Skeleton className="h-full min-h-[320px] w-full" data-testid="badge-pane-skeleton" />
          <Skeleton className="h-full min-h-[320px] w-full" data-testid="badge-pane-skeleton" />
        </div>
      ) : templateQuery.isError && !initialized ? (
        // The full-page load-error state is only for a NEVER-loaded editor
        // (`!initialized`): once a doc has been seeded, a later FAILED
        // refetch also flips `templateQuery.isError` to true (react-query
        // keeps the stale `data` but sets status to 'error'), and hiding the
        // operator's — possibly dirty — editor behind this screen would
        // discard their working context. Those later failures surface where
        // they happened instead: inside the conflict dialogs (reload) or on
        // the inline `badgeSaveError` line (save).
        <div className="flex flex-1 flex-col items-start gap-2 rounded-lg border border-border p-6">
          <p className="text-body text-destructive">{t("badgeLoadError")}</p>
          <Button type="button" variant="outline" onClick={() => templateQuery.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[240px_1fr_280px] gap-4">
          <ElementsPane
            doc={state.doc}
            selectedId={state.selectedId}
            onSelect={(id) => dispatch({ type: "select", id })}
            onAdd={(element) => dispatch({ type: "add", element })}
            onRemove={(id) => dispatch({ type: "remove", id })}
            fieldSchema={fieldSchema}
          />

          <div className="flex h-full flex-col gap-2" data-testid="badge-pane-canvas">
            {/* Keyed off `state.doc.elements` (not `template === null`) so
                this guidance also covers an already-saved-but-still-empty
                template, and disappears the moment an element is added --
                see this component's own doc comment above. Rendered ABOVE
                the real canvas (Task 8), not overlaid on it: the canvas
                itself always shows the (empty) artboard underneath. */}
            {state.doc.elements.length === 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                <p className="text-body font-medium text-foreground">{t("badgeEmptyTitle")}</p>
                <p className="mx-auto max-w-sm text-caption text-muted-foreground">
                  {t("badgeEmptyBody", {
                    width: state.doc.width_mm,
                    height: state.doc.height_mm,
                    dpi: state.doc.dpi,
                  })}
                </p>
              </div>
            )}
            <BadgeCanvas
              doc={state.doc}
              selectedId={state.selectedId}
              // Task 12's job to populate for real -- an empty object is a
              // valid input today; BadgeCanvas's own resolveElementText
              // falls back to each element's static `text` when a source
              // doesn't resolve, never fabricating a value.
              previewData={{}}
              onSelect={(id) => dispatch({ type: "select", id })}
              onMove={(id, x, y) => dispatch({ type: "move", id, x, y })}
              onResize={(id, width, height) => dispatch({ type: "resize", id, width, height })}
            />
          </div>

          <PropertiesPane
            element={state.doc.elements.find((element) => element.id === state.selectedId) ?? null}
            fieldSchema={fieldSchema}
            config={state.doc}
            onUpdate={(id, patch) => dispatch({ type: "update", id, patch })}
          />
        </div>
      )}
    </div>
  );
}
