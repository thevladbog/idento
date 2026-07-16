import { Button, Skeleton } from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { BadgeCanvas } from "./BadgeCanvas";
import { editorReducer, initialEditorState } from "./editorState";
import { ElementsPane } from "./ElementsPane";
import { useBadgeTemplate } from "./hooks";
import { PropertiesPane } from "./PropertiesPane";
import { parseTemplateDoc } from "./templateTypes";
import { $api } from "../../shared/api/query";

// Same rationale as AttendeesPage.tsx / ZonesPage.tsx / StaffPage.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/badge");

// Board 4a — the badge editor's route/page shell (P3.1 Task 6). Owns:
//  - the editor-local top bar (title + a save-state-pill placeholder slot,
//    filled in by Task 10's save model, + the right-aligned "Test print" /
//    "ZPL preview" actions, both locked with the P2.2 disabled-Button+Lock
//    idiom until P3.2 wires them up);
//  - the three-pane grid hosting the Elements / Canvas / Properties regions
//    (Tasks 7-9 replace these labeled placeholders with the real panes);
//  - the editor's document-state reducer (Task 5), seeded here from
//    `useBadgeTemplate`'s query once it resolves — Tasks 7-12 consume
//    `state`/`dispatch` via props only, never re-deriving them from the
//    query themselves.
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

  // Seeds the reducer from the fetched template exactly once per event —
  // an `initializedRef` guard (same pattern as ZoneRuleEditor.tsx's
  // clause derivation) stops a background refetch (window refocus, or a
  // BADGE_TEMPLATE_KEY invalidation after another operator's save) from
  // re-dispatching "load" and clobbering in-progress edits (doc, dirty,
  // selectedId all reset). Reset whenever the target event changes so
  // navigating between events re-seeds from the new event's template.
  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    initializedRef.current = false;
  }, [eventId]);

  React.useEffect(() => {
    if (initializedRef.current) return;
    if (!templateQuery.isSuccess) return;
    originalRawRef.current = templateQuery.data.template;
    dispatch({
      type: "load",
      doc: parseTemplateDoc(templateQuery.data.template),
      version: templateQuery.data.version,
    });
    initializedRef.current = true;
  }, [templateQuery.isSuccess, templateQuery.data]);

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <h2 className="text-page-title">{t("badgeTitle")}</h2>
        {/* Save-state pill (board 4c: Saved/Saving/Unsaved changes/Conflict)
            mounts here once Task 10 wires the save mutation — an empty
            spacer keeps today's locked actions right-aligned in the
            meantime. */}
        <div className="flex-1" data-testid="badge-save-state-slot" />
        <Button type="button" variant="outline" disabled aria-disabled="true">
          <Lock aria-hidden className="size-4" />
          {t("badgeTestPrintLocked")}
        </Button>
        <Button type="button" variant="outline" disabled aria-disabled="true">
          <Lock aria-hidden className="size-4" />
          {t("badgeZplPreviewLocked")}
        </Button>
      </div>

      {templateQuery.isLoading ? (
        <div className="grid flex-1 grid-cols-[240px_1fr_280px] gap-4">
          <Skeleton className="h-full min-h-[320px] w-full" data-testid="badge-pane-skeleton" />
          <Skeleton className="h-full min-h-[320px] w-full" data-testid="badge-pane-skeleton" />
          <Skeleton className="h-full min-h-[320px] w-full" data-testid="badge-pane-skeleton" />
        </div>
      ) : templateQuery.isError ? (
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
