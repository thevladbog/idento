import { Button, ConfirmDialog, Skeleton } from "@idento/ui";
import { getRouteApi, useBlocker } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { BadgeCanvas } from "./BadgeCanvas";
import { editorReducer, initialEditorState } from "./editorState";
import { ElementsPane } from "./ElementsPane";
import { GuardDialog } from "./GuardDialog";
import { useBadgeTemplate } from "./hooks";
import { PreviewPicker } from "./PreviewPicker";
import { PropertiesPane } from "./PropertiesPane";
import { SaveStatePill } from "./SaveStatePill";
import { parseTemplateDoc, serializeTemplateDoc } from "./templateTypes";
import { usePreviewAttendee } from "./usePreviewAttendee";
import { useSaveTemplate } from "./useSaveTemplate";
import { useFontCoverage } from "./zpl/fontCoverage";
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
//  - the unsaved-changes guard (Task 11): `useBlocker` (navigation/tab-close)
//    plus a page-level Escape listener, both driving the SAME `GuardDialog`
//    in one of two modes — see `performSave`/`revertToBaseline`/`resolver`
//    below for the one-save-path/one-dialog wiring.
//  - the canvas's live preview data (Task 12): `usePreviewAttendee` resolves
//    the default/switched/sample-fallback attendee once here, and both the
//    top-bar `PreviewPicker` and `BadgeCanvas`'s `previewData` prop are fed
//    from that SAME hook call — never re-derived independently.
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

  // P3.2 Task 4: PropertiesPane's font <select> needs the event's uploaded
  // fonts (its "Event fonts" optgroup) + their Cyrillic-coverage flags.
  // Fetched inline here (FontsCard.tsx precedent, per the task brief) rather
  // than threaded through some other hook -- `useFontCoverage` does its OWN
  // internal `$api.useQuery` against this SAME query key, so TanStack Query
  // dedupes the two into a single network fetch; this call exists purely to
  // get the LIST (not just the coverage flags) down to the pane. Same
  // "fetch once at the page, pass down as props" convention `fieldSchema`
  // above already uses -- deliberately NOT gated behind `initialized`: an
  // empty fonts list while loading just renders the built-in-only select,
  // same honest "not ready yet" default fieldSchema's `?? []` already uses.
  const fontsQuery = $api.useQuery("get", "/api/events/{event_id}/fonts", {
    params: { path: { event_id: eventId } },
  });
  const fonts = fontsQuery.data ?? [];
  const fontCoverage = useFontCoverage(eventId);

  // P3.1 Task 12: the canvas's live preview data + the top-bar switcher's
  // state, both driven from this one hook (see usePreviewAttendee.ts for
  // the default-first-attendee / sample-fallback / debounced-search rules).
  const preview = usePreviewAttendee(eventId);
  // Whether PreviewPicker's own DropdownMenu is open -- lifted up (not left
  // as that component's internal state) specifically so handlePageKeyDown
  // below can gate on it; see PreviewPicker.tsx's `open` prop doc comment
  // for why a DropdownMenu needs this same treatment the Reload/Overwrite
  // ConfirmDialogs already get.
  const [previewPickerOpen, setPreviewPickerOpen] = React.useState(false);

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

  // Codex round (Fix 4): mirrors the LATEST render's `eventId`, updated
  // unconditionally on every render (not inside an effect — a `useEffect`
  // would only catch up a render late, which is exactly the window this
  // guards). `performSave`/`handleOverwriteConfirm`'s save callbacks capture
  // the eventId a save was FOR at `.mutate()` time and compare it against
  // `currentEventIdRef.current` once the request settles, to tell whether
  // the operator has since navigated to a DIFFERENT event's editor before
  // that happened — see those functions' own comments for why this can
  // happen (the dirty guard deliberately lets navigation proceed during a
  // pending save).
  const currentEventIdRef = React.useRef(eventId);
  currentEventIdRef.current = eventId;

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
  const saveTemplate = useSaveTemplate();
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

  // The ONE save path (Task 11): both the top-bar Save button AND the guard
  // dialog's "Save & leave"/"Save" action call this SAME function — neither
  // re-derives `serializeTemplateDoc`'s call, and both are gated by the SAME
  // `saveDisabled` rule (so a guard-triggered save while, say, an unresolved
  // conflict is already showing is a safe no-op — same as the top-bar
  // button being disabled in that state — rather than a second, differently
  // gated attempt). `onSaved` fires only on a genuine 2xx success. `onFailed`
  // fires on EITHER a 409 or any other failure, AFTER the SAME onError
  // branch `handleSave` always ran (conflict banner / inline error) — the
  // guard dialog passes `resolver.reset()`/`setGuardRevertOpen(false)` here
  // so a failed guard-triggered save closes the dialog (revealing the
  // conflict/error banner underneath) instead of leaving `useBlocker`'s
  // resolver promise dangling forever (neither `proceed()` nor `reset()`
  // ever called — the whole point of the brief's "never navigates over an
  // unresolved conflict": it must actively `reset()`, not just skip
  // `proceed()`).
  function performSave(onSaved?: () => void, onFailed?: () => void) {
    if (saveDisabled) return;
    setSaveErrorVisible(false);
    const template = serializeTemplateDoc(state.doc, originalRawRef.current);
    // Codex round (Fix 4): the eventId THIS save is FOR. `eventId` itself is
    // a plain render-time binding — reading it again from inside the
    // callbacks below wouldn't detect a LATER navigation, since a stale
    // closure only ever sees the value from when performSave was called.
    // `currentEventIdRef` (above) is what lets these callbacks tell "this
    // render's eventId" from "the eventId this save was actually for".
    const savedForEventId = eventId;
    saveTemplate.mutate(
      { params: { path: { id: eventId } }, body: { template, version: state.version } },
      {
        onSuccess: (data) => {
          // Stale: the operator has navigated to a DIFFERENT event's editor
          // since this save was kicked off (the dirty guard's
          // `shouldBlockFn` deliberately lets navigation proceed while
          // `saveTemplate.isPending` is true, precisely so a save doesn't
          // trap the operator on the page — see that function's own
          // comment). Acting on `originalRawRef`/`dispatch` now would
          // overwrite THAT OTHER event's baseline and falsely flip ITS pill
          // to "Saved" with THIS save's version/timestamp. useSaveTemplate.ts's
          // own cache seeding/invalidation already ran, unconditionally,
          // keyed to the CAPTURED (this save's actual) eventId — only these
          // UI reactions, which always act on whatever's CURRENTLY
          // rendered, need to no-op here.
          if (savedForEventId === currentEventIdRef.current) {
            // Refresh the snapshot to the exact object just PUT — never to
            // a later `templateQuery.data.template` (see originalRawRef
            // above).
            originalRawRef.current = template;
            dispatch({ type: "saved", version: data.version, savedAt: new Date().toISOString() });
          }
          onSaved?.();
        },
        onError: (error) => {
          if (savedForEventId === currentEventIdRef.current) {
            if (error instanceof ApiError && error.status === 409) {
              setConflict(true);
            } else {
              setSaveErrorVisible(true);
            }
          }
          onFailed?.();
        },
      },
    );
  }

  function handleSave() {
    performSave();
  }

  // --- Dirty guard (Task 11) ---------------------------------------------
  // `shouldBlockFn` gets `{current, next, action}` for every navigation
  // attempt. Comparing `next.pathname`/`current.pathname` — the RESOLVED
  // path (e.g. "/events/evt-1/badge"), not the route's PATTERN
  // ("/events/$eventId/badge") — is deliberate (final-review Important 2):
  // comparing the pattern used to also treat switching between two EVENTS'
  // own badge editors (same pattern, different `$eventId`) as "staying on
  // this same badge route", silently discarding in-progress edits on a
  // cross-event nav. `pathname` still keeps the ONE exemption that pattern
  // comparison was trying to express — a future same-event, search-param-only
  // change (Task 12's `?attendee=` switcher) leaves `pathname` identical
  // (only `search` differs), so it stays unblocked exactly as before. This
  // matches the existing cross-event navigation tests above (Task 6/10's
  // "re-seeds … (clean doc)", "resets … when navigating to another event",
  // "keeps Save disabled during the window …"), which navigate directly via
  // `router.navigate` on a CLEAN doc and expect no guard interaction, and
  // the "blocks a cross-event badge->badge navigation while dirty" test,
  // which proves the guard now DOES engage once the doc is dirty — only a
  // clean doc (or a same-pathname change) ever passes straight through.
  // `!saveTemplate.isPending` additionally lets a navigation attempt through
  // uninterrupted while the top-bar Save button's own PUT is already in
  // flight, rather than layering the guard on top of an in-progress save.
  const resolver = useBlocker({
    shouldBlockFn: ({ current, next }) => (
      state.dirty && !saveTemplate.isPending && next.pathname !== current.pathname
    ),
    enableBeforeUnload: () => state.dirty,
    withResolver: true,
  });

  // Escape-triggered "revert" mode (Task 11): there's nowhere to navigate,
  // so this is a SEPARATE open flag from the blocker's own resolver, but it
  // drives the exact SAME GuardDialog (see `guardOpen`/`guardSaveLabel`
  // below) and the exact same `performSave` path.
  const [guardRevertOpen, setGuardRevertOpen] = React.useState(false);

  // Discard, in revert mode: restore the doc to the LAST-LOADED baseline.
  // Re-parses `originalRawRef.current` — deliberately NOT
  // `templateQuery.data.template` — because the load effect above already
  // stops trusting a background refetch once `initialized` (see that
  // effect's own comment): `templateQuery.data` can by now be AHEAD of what
  // was actually loaded into the reducer, and reverting to that newer,
  // never-shown doc would revert to something the operator never even saw.
  // `state.version` is the version paired with THAT SAME baseline — both
  // are only ever updated together (the load effect, and every successful
  // save/reload/overwrite handler above) and never touched by an edit
  // action — so this keeps the doc/version/raw triple exactly as coherent
  // as it already was. `originalRawRef.current` itself is deliberately left
  // untouched: reverting TO the baseline means it's already in sync with it
  // by definition, nothing to refresh.
  function revertToBaseline() {
    dispatch({ type: "load", doc: parseTemplateDoc(originalRawRef.current), version: state.version });
    setConflict(false);
    setSaveErrorVisible(false);
  }

  const guardBusy = saveTemplate.isPending;
  const guardOpen = resolver.status === "blocked" || guardRevertOpen;
  const guardSaveLabel = resolver.status === "blocked" ? t("badgeGuardSave") : t("badgeGuardSaveStay");

  function handleGuardDiscard() {
    if (resolver.status === "blocked") {
      resolver.proceed();
    } else {
      revertToBaseline();
      setGuardRevertOpen(false);
    }
  }

  function handleGuardKeep() {
    if (resolver.status === "blocked") {
      resolver.reset();
    } else {
      setGuardRevertOpen(false);
    }
  }

  function handleGuardSave() {
    if (resolver.status === "blocked") {
      performSave(() => resolver.proceed(), () => resolver.reset());
    } else {
      performSave(() => setGuardRevertOpen(false), () => setGuardRevertOpen(false));
    }
  }

  // Page-level Escape listener. Task 8's canvas contract: the artboard
  // swallows Escape (stopPropagation) whenever something is selected
  // (deselect-first) and only lets it bubble here once nothing is selected.
  // Also inert whenever a save is pending, or ANY dialog (this one, Task
  // 10's Reload/Overwrite conflict dialogs, or — Task 12 — the
  // PreviewPicker's DropdownMenu) is already open — without that check,
  // React's own portal event semantics would ALSO bubble an Escape pressed
  // to dismiss one of those OTHER overlays up to this same handler: Radix's
  // Escape-to-close listens on `document` natively (see
  // @radix-ui/react-dismissable-layer), entirely in parallel with — not
  // instead of — React's own synthetic dispatch, which still walks the
  // REACT tree across a Portal regardless of where in the real DOM it
  // renders, so the same keystroke reaches both. `previewPickerOpen` is
  // this SAME check for a DropdownMenu (not a Dialog — no `role="dialog"`,
  // so it isn't covered by any Dialog-specific check the OTHER guards might
  // rely on) — see PreviewPicker.tsx's `open` prop for why it's lifted up
  // here instead of staying that component's own internal state.
  function handlePageKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    if (guardOpen || reloadDialogOpen || overwriteDialogOpen || previewPickerOpen) return;
    // Deselect-first, regardless of where focus currently is (final-review
    // Important 4). Task 8's canvas contract (BadgeCanvas.tsx's own
    // artboard keydown handler) only swallows Escape and deselects when the
    // keystroke actually ORIGINATES on the artboard — it stops propagation
    // there, so this handler never even sees that event. But a selection
    // can persist while focus moves elsewhere (e.g. into a PropertiesPane
    // input, or the elements pane), and pressing Escape from there bypasses
    // the canvas's handler entirely, landing here directly. Checking
    // `state.selectedId` here too — BEFORE the dirty check below, and
    // unconditionally (not gated on `state.dirty`, mirroring
    // BadgeCanvas.tsx's own unconditional deselect) — means the FIRST
    // Escape always deselects when something is selected, no matter where
    // focus is; only a SECOND Escape, once nothing is selected, can reach
    // the dirty check and open the revert-guard dialog.
    if (state.selectedId) {
      dispatch({ type: "select", id: null });
      return;
    }
    if (!state.dirty || saveTemplate.isPending) return;
    setGuardRevertOpen(true);
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
      // Codex round (Fix 4): same captured-eventId guard as performSave —
      // see currentEventIdRef's own comment above.
      const savedForEventId = eventId;
      saveTemplate.mutate(
        { params: { path: { id: eventId } }, body: { template, version: currentVersion } },
        {
          onSuccess: (data) => {
            if (savedForEventId === currentEventIdRef.current) {
              originalRawRef.current = template;
              dispatch({ type: "saved", version: data.version, savedAt: new Date().toISOString() });
              setConflict(false);
              setOverwriteDialogOpen(false);
              // Final-review Important 5: a PRIOR overwrite attempt that
              // itself failed (non-409, the `else` branch below) leaves this
              // page-level inline error line up — it must not survive a
              // LATER, successful retry. Nothing else on this success path
              // clears it (performSave's own success branch does, but this
              // is the SEPARATE overwrite-retry mutation call, not a
              // performSave call).
              setSaveErrorVisible(false);
            }
          },
          onError: (error) => {
            if (savedForEventId !== currentEventIdRef.current) return;
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
    <div className="flex h-full min-h-[420px] flex-col gap-4" onKeyDown={handlePageKeyDown}>
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <h2 className="text-page-title">{t("badgeTitle")}</h2>
        <PreviewPicker
          mode={preview.mode}
          attendee={preview.attendee}
          options={preview.options}
          search={preview.search}
          onSearchChange={preview.setSearch}
          onSelect={preview.setAttendee}
          listError={preview.listError}
          open={previewPickerOpen}
          onOpenChange={(open) => {
            setPreviewPickerOpen(open);
            // Review Minor 1: a search typed to browse but abandoned (the
            // picker closed without a pick) must not still filter the
            // option list the next time the dropdown opens. Also runs on a
            // selection-close (Radix fires onOpenChange(false) then too) --
            // harmless, setAttendee already cleared the search itself.
            if (!open) preview.clearSearch();
          }}
        />
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

      <GuardDialog
        open={guardOpen}
        busy={guardBusy}
        saveLabel={guardSaveLabel}
        onDiscard={handleGuardDiscard}
        onKeep={handleGuardKeep}
        onSave={handleGuardSave}
        // Final-review Important 3: `performSave` (both this dialog's Save
        // button and the top-bar one share it) silently no-ops when
        // `saveDisabled` is true — most notably an unresolved `conflict`.
        // Passing the SAME page-level `saveDisabled` here means the button
        // itself now reflects that instead of looking clickable and doing
        // nothing.
        saveDisabled={saveDisabled}
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
              previewData={preview.data}
              onSelect={(id) => dispatch({ type: "select", id })}
              onMove={(id, x, y) => dispatch({ type: "move", id, x, y })}
              onResize={(id, width, height) => dispatch({ type: "resize", id, width, height })}
            />
          </div>

          <PropertiesPane
            element={state.doc.elements.find((element) => element.id === state.selectedId) ?? null}
            fieldSchema={fieldSchema}
            config={state.doc}
            fonts={fonts}
            fontCoverage={fontCoverage}
            onUpdate={(id, patch) => dispatch({ type: "update", id, patch })}
          />
        </div>
      )}
    </div>
  );
}
