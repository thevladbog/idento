import {
  Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState,
  Skeleton, cn,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ZONES_KEY, useEventZonesWithStats } from "./hooks";
import { ZoneFormDialog } from "./ZoneFormDialog";
import { ZoneRuleEditor } from "./ZoneRuleEditor";
import { ZONE_COLOR_CLASSES, zoneColorKey } from "./zoneColors";
import { ApiError } from "../../shared/api/ApiError";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

// Either the create-mode dialog (no target zone) or the edit-mode dialog for
// a specific zone — mutually exclusive by construction (only one row menu or
// the "+ New zone" button can be acted on at a time), so ZonesPage renders a
// single shared ZoneFormDialog instance driven by this union instead of two
// separately-mounted dialogs.
type FormDialogState = { mode: "create" } | { mode: "edit"; zone: EventZone };

// Same rationale as AttendeesPage.tsx / EventWorkspaceLayout.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/zones");

// Board 6b — the zones list screen: header (title + mono count + caption),
// a compact zone-row list card, empty/loading/error states. The "+ New
// zone" button (both the header's and the EmptyState's — they share the
// same accessible name) opens ZoneFormDialog in create mode; the row `⋯`
// menu's Edit/Delete items are wired here too (Task 4 adds a third item,
// zonesMenuRules, for the access-rule builder).
export function ZonesPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const zonesQuery = useEventZonesWithStats(eventId);
  const queryClient = useQueryClient();

  const zones = zonesQuery.data ?? [];

  const [formDialog, setFormDialog] = React.useState<FormDialogState | null>(null);
  const [deletingZone, setDeletingZone] = React.useState<EventZone | null>(null);
  // Holds the server's Error.error text for the CURRENT delete attempt, so
  // the typed-confirm dialog can show it verbatim rather than a canned
  // string — the brief's explicit requirement for this destructive action
  // (unlike DangerZoneCard/AttendeeDrawer's canned-message tier).
  const [deleteErrorMessage, setDeleteErrorMessage] = React.useState<string | null>(null);
  // Same cancel-during-pending session-id-ref pattern as
  // DangerZoneCard.tsx:51-93 — `deleteZone.reset()` on close only detaches
  // the mutation observer, it does not cancel the in-flight DELETE or stop
  // a late onSuccess/onError from firing for a session the user has already
  // backed out of.
  const deleteSessionRef = React.useRef(0);

  // Task 4 — the inline OR-rule builder. Only one zone's editor is ever
  // expanded at a time: `expandedZoneId` gates which row renders
  // `ZoneRuleEditor`, and `rulesDirty`/`rulesBusy` are lifted from that
  // single mounted editor (via its onDirtyChange/onBusyChange props) so
  // this page can (a) block opening a DIFFERENT zone's editor while the
  // current one has unsaved edits (`requestExpand` below, surfaced as the
  // `zonesRulesUnsavedHint` caption) and (b) gate the open row's OWN
  // collapse toggle and `⋯` menu while its save is genuinely in flight —
  // the busy-gating audit this task's brief calls out as P2.1's hardest
  // lesson, covering every dismiss path for that row, not just Save/Cancel
  // (which ZoneRuleEditor itself already gates internally).
  const [expandedZoneId, setExpandedZoneId] = React.useState<string | null>(null);
  const [rulesDirty, setRulesDirty] = React.useState(false);
  const [rulesBusy, setRulesBusy] = React.useState(false);
  const [showUnsavedHint, setShowUnsavedHint] = React.useState(false);

  // The hint is only ever a reaction to a blocked attempt — once the open
  // editor stops being dirty (Cancel, or a successful Save unmounting it
  // entirely), any stale hint from an earlier blocked attempt no longer
  // applies.
  React.useEffect(() => {
    if (!rulesDirty) setShowUnsavedHint(false);
  }, [rulesDirty]);

  // Reconciles the expanded-editor state against the CURRENT zones list —
  // if the expanded zone is no longer in it, every piece of lifted editor
  // state is reset. Without this, deleting the currently-expanded, dirty
  // zone (its `⋯` menu is NOT disabled by mere dirtiness — only by a
  // pending save) soft-locks the whole feature: the editor unmounts with
  // `rulesDirty` still true and `expandedZoneId` pointing at the deleted
  // id, so every later requestExpand is blocked by the dirty-guard while
  // the hint that explains the block only renders inside the expanded row —
  // which no longer exists. Also covers zones deleted externally (another
  // tab/operator) surfacing via any ZONES_KEY refetch. Gated on isSuccess,
  // not on the `zones` fallback array — while the list is loading or
  // errored, `data` is undefined and the `?? []` fallback would falsely
  // read as "the zone is gone".
  React.useEffect(() => {
    if (expandedZoneId === null || !zonesQuery.isSuccess) return;
    const stillExists = (zonesQuery.data ?? []).some((entry) => zoneIdentity(entry).id === expandedZoneId);
    if (stillExists) return;
    setExpandedZoneId(null);
    setRulesDirty(false);
    setRulesBusy(false);
    setShowUnsavedHint(false);
  }, [expandedZoneId, zonesQuery.isSuccess, zonesQuery.data]);

  function requestExpand(zoneId: string) {
    if (expandedZoneId === zoneId) {
      if (rulesBusy) return;
      setExpandedZoneId(null);
      setShowUnsavedHint(false);
      return;
    }
    if (expandedZoneId !== null && (rulesDirty || rulesBusy)) {
      setShowUnsavedHint(true);
      return;
    }
    setExpandedZoneId(zoneId);
    setShowUnsavedHint(false);
  }

  const deleteZone = $api.useMutation("delete", "/api/zones/{id}", {
    onMutate: () => ({ sessionId: deleteSessionRef.current }),
    onSuccess: (_data, _vars, onMutateResult) => {
      // The zone is genuinely gone server-side regardless of whether the
      // user has since cancelled this dialog session, so invalidation runs
      // unconditionally — only the dialog-closing reaction below is gated.
      void queryClient.invalidateQueries({ queryKey: ZONES_KEY(eventId) });
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setDeletingZone(null);
    },
    onError: (error, _vars, onMutateResult) => {
      if (onMutateResult?.sessionId !== deleteSessionRef.current) return;
      setDeleteErrorMessage(error instanceof ApiError ? error.message : t("zonesDeleteError"));
    },
  });

  // Routed to as the ConfirmDialog's onOpenChange for every user-driven close
  // path (Cancel button, Escape, overlay click) — same shape as
  // DangerZoneCard.tsx's handleDialogOpenChange. Unlike ZoneFormDialog's
  // create/edit guard, this does NOT block closing while the delete is
  // pending: the zone is deleted server-side either way, so there's nothing
  // to protect by forcing the user to wait.
  function handleDeleteDialogOpenChange(open: boolean) {
    if (!open) {
      deleteSessionRef.current += 1;
      setDeleteErrorMessage(null);
      deleteZone.reset();
      setDeletingZone(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-page-title">{t("zonesTitle")}</h2>
          {zonesQuery.isLoading ? (
            <Skeleton className="h-4 w-8" data-testid="zones-total-skeleton" />
          ) : (
            <span className="font-mono text-caption text-muted-foreground">{zones.length}</span>
          )}
        </div>
        <span className="text-caption text-muted-foreground">{t("zonesCaption")}</span>
        <div className="ml-auto">
          <Button type="button" onClick={() => setFormDialog({ mode: "create" })}>
            {t("zonesNewZone")}
          </Button>
        </div>
      </div>

      {zonesQuery.isLoading ? (
        <ZonesListSkeleton />
      ) : zonesQuery.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-6">
          <p className="text-body text-destructive">{t("zonesLoadError")}</p>
          <Button type="button" variant="outline" onClick={() => zonesQuery.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : zones.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t("zonesEmptyTitle")}
          description={t("zonesEmptyBody")}
          actions={
            <Button type="button" onClick={() => setFormDialog({ mode: "create" })}>
              {t("zonesNewZone")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col rounded-lg border border-border">
          {zones.map((entry, index) => {
            const id = zoneIdentity(entry).id;
            const isExpanded = expandedZoneId === id;
            const isLast = index === zones.length - 1;
            return (
              <div
                key={id}
                className={cn(
                  !isLast && "border-b border-border",
                  // Board styling for the expanded row: success-tinted bg +
                  // 3px left accent, token classes only.
                  isExpanded && "border-l-[3px] border-l-success bg-success/5",
                )}
                data-testid={isExpanded ? `zone-row-expanded-${id}` : undefined}
              >
                <ZoneRow
                  entry={entry}
                  onEdit={(zone) => setFormDialog({ mode: "edit", zone })}
                  onDelete={(zone) => {
                    setDeleteErrorMessage(null);
                    setDeletingZone(zone);
                  }}
                  expanded={isExpanded}
                  // Busy only ever applies to the CURRENTLY expanded row —
                  // there's exactly one mounted ZoneRuleEditor, so no other
                  // row's controls need gating.
                  rowBusy={isExpanded && rulesBusy}
                  onToggleRules={() => requestExpand(id)}
                />
                {isExpanded ? (
                  <div className="px-4 pb-4">
                    {showUnsavedHint ? (
                      <p className="mb-2 text-caption text-muted-foreground">{t("zonesRulesUnsavedHint")}</p>
                    ) : null}
                    <ZoneRuleEditor
                      eventId={eventId}
                      zoneId={id}
                      onSaved={() => {
                        setExpandedZoneId(null);
                        setRulesDirty(false);
                        setRulesBusy(false);
                        setShowUnsavedHint(false);
                      }}
                      onDirtyChange={setRulesDirty}
                      onBusyChange={setRulesBusy}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ZoneFormDialog
        open={formDialog !== null}
        onOpenChange={(open) => {
          if (!open) setFormDialog(null);
        }}
        eventId={eventId}
        zone={formDialog?.mode === "edit" ? formDialog.zone : undefined}
      />

      <ConfirmDialog
        open={deletingZone !== null}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t("zonesDeleteConfirmTitle")}
        description={
          deleteErrorMessage ? (
            <>
              {t("zonesDeleteConfirmBody")}
              <span className="mt-1 block text-destructive">{deleteErrorMessage}</span>
            </>
          ) : (
            t("zonesDeleteConfirmBody")
          )
        }
        confirmLabel={t("zonesDeleteConfirmAction")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        destructive
        typedConfirmation={deletingZone?.name ?? ""}
        typedConfirmationLabel={t("zonesDeleteConfirmLabel", { name: deletingZone?.name ?? "" })}
        confirmDisabled={deleteZone.isPending}
        onConfirm={() => {
          if (!deletingZone) return;
          setDeleteErrorMessage(null);
          deleteZone.mutate({ params: { path: { id: deletingZone.id } } });
        }}
      />
    </div>
  );
}

interface ZoneRowProps {
  entry: EventZoneWithStats;
  onEdit: (zone: EventZone) => void;
  onDelete: (zone: EventZone) => void;
  expanded: boolean;
  // True only while THIS row's rule-editor save is pending — disables both
  // the access-type text's collapse toggle and the whole `⋯` menu trigger,
  // so neither dismiss path can fire mid-save (busy-gating audit, Task 4
  // brief).
  rowBusy: boolean;
  onToggleRules: () => void;
}

function ZoneRow({
  entry, onEdit, onDelete, expanded, rowBusy, onToggleRules,
}: ZoneRowProps) {
  const { t } = useTranslation();
  const { zone } = entry;
  const identity = zoneIdentity(entry);
  const colorKey = zoneColorKey(zone);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", ZONE_COLOR_CLASSES[colorKey])} />
      <div className="flex flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="text-body font-bold">{identity.name}</span>
          {zone.is_active === false ? (
            <span className="text-caption font-normal text-muted-foreground">{t("zonesInactive")}</span>
          ) : null}
        </span>
        {/* Reconciliation #2 (P2.2 plan): "Entrance zone" ≡ is_registration_zone
            — no other entrance concept exists on the model. */}
        {zone.is_registration_zone ? (
          <span className="text-caption text-muted-foreground">{t("zonesEntranceSubtitle")}</span>
        ) : null}
      </div>
      {/* Reconciliation #3: rules default-allow when none exist, so
          access_rules_count === 0 reads as "All attendees"; > 0 as "By
          rule" (real rule count, never a fabricated people/match count —
          reconciliation #4 bans those everywhere on this page). Task 4:
          this is now also an entry point into the inline rule builder — a
          real <button>, not a static span, so it's keyboard-reachable. */}
      <button
        type="button"
        onClick={onToggleRules}
        disabled={rowBusy}
        aria-expanded={expanded}
        className="rounded-sm text-body text-muted-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:no-underline"
      >
        {entry.access_rules_count === 0 ? t("zonesAccessAll") : t("zonesAccessByRule", { count: entry.access_rules_count })}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={rowBusy}
            aria-label={t("zonesRowMenuLabel", { name: identity.name })}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            ⋯
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(zone)}>{t("zonesMenuEdit")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleRules}>{t("zonesMenuRules")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDelete(zone)}>{t("zonesMenuDelete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ZonesListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="zones-list-skeleton">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
