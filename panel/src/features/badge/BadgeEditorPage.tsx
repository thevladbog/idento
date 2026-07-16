import { Button, Skeleton } from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { editorReducer, initialEditorState } from "./editorState";
import { useBadgeTemplate } from "./hooks";
import { parseTemplateDoc } from "./templateTypes";

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
          <div className="rounded-lg border border-border p-4" data-testid="badge-pane-elements">
            <h3 className="text-body font-medium text-muted-foreground">{t("badgePaneElements")}</h3>
          </div>

          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-center"
            data-testid="badge-pane-canvas"
          >
            {state.doc.elements.length === 0 ? (
              <>
                <p className="text-body font-medium text-foreground">{t("badgeEmptyTitle")}</p>
                <p className="max-w-sm text-caption text-muted-foreground">
                  {t("badgeEmptyBody", {
                    width: state.doc.width_mm,
                    height: state.doc.height_mm,
                    dpi: state.doc.dpi,
                  })}
                </p>
              </>
            ) : (
              <p className="text-caption text-muted-foreground">{t("badgePaneCanvas")}</p>
            )}
          </div>

          <div className="rounded-lg border border-border p-4" data-testid="badge-pane-properties">
            <h3 className="text-body font-medium text-muted-foreground">{t("badgePaneProperties")}</h3>
          </div>
        </div>
      )}
    </div>
  );
}
