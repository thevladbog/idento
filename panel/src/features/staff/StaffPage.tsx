import {
  Button, ConfirmDialog, EmptyState, Skeleton,
} from "@idento/ui";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Users } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import "./print.css";
import { AddStaffDialog } from "./AddStaffDialog";
import { QrPrintSheet, type QrPrintCard } from "./QrPrintSheet";
import { ROLE_LABEL_KEYS, StaffCard, formatZonesCaption } from "./StaffCard";
import {
  STAFF_KEY, USER_ZONES_KEY, useEventStaff, useUserZoneAssignments,
} from "./hooks";
import type { StaffUser, StaffZoneAssignment } from "./hooks";
import { useEventZones } from "../attendees/hooks";
import { $api } from "../../shared/api/query";
import { getCurrentTenant } from "../../shared/api/session";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

// Same rationale as AttendeesPage.tsx / ZonesPage.tsx / EventWorkspaceLayout.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/staff");

interface PrintAllProgress {
  done: number;
  total: number;
}

// Reads whatever this user's zone assignments already resolved to (via the
// per-card useUserZoneAssignments hook mounted in the grid below) straight
// out of the query cache — "Print all" needs every staff member's zones
// caption up front to build the print sheet's cards, but deliberately does
// NOT lift that per-card fetch state up into StaffPage (that would
// duplicate the exact per-card loading/error handling the grid already
// owns).
//
// Final-review Finding 2: `getQueryData(...) ?? []` used to collapse BOTH
// "genuinely resolved to zero assignments" AND "never resolved / errored"
// into the same empty array — printing the false "No zones assigned" claim
// for a member whose zones we actually couldn't verify. `getQueryData`
// returns undefined for exactly that unverifiable case (no successful
// fetch has ever landed in cache), so it's checked explicitly and rendered
// as a blank/omitted zones segment instead — never a fabricated claim,
// mirroring formatPrintZonesCaption's "error" handling for the same reason.
function buildMemberZonesCaption(
  queryClient: QueryClient,
  member: StaffUser,
  zoneNameById: Map<string, string>,
  t: TFunction,
): string {
  const assignments = queryClient.getQueryData<StaffZoneAssignment[]>(USER_ZONES_KEY(member.id));
  if (assignments === undefined) return "";
  // Foreign ids (assignments belonging to some OTHER event — see
  // StaffCardRow's comment below for why) are filtered out entirely, same
  // as the on-screen caption.
  const zoneNames = assignments
    .filter((a) => zoneNameById.has(a.zone_id))
    .map((a) => zoneNameById.get(a.zone_id)!);
  return formatZonesCaption(t, zoneNames);
}

// Board 6c — the staff list screen: header (title + mono count + caption +
// bulk print/add actions), a 3-per-row card grid, empty/loading/error
// states, and a footer note. Role gating (admin/manager/staff) follows
// OrganizationPage.tsx:65's exact pattern: `getCurrentTenant()` only
// supplies the active tenant's id (its own `.role` field doesn't exist —
// neither the generated `Tenant` schema nor the backend's `models.Tenant`
// struct carry one), then `GET /api/tenants/{id}` is fetched live for the
// caller's ROLE IN THAT TENANT (`TenantMembership.role`). This is
// deliberately NOT `getCurrentUser()?.role`: OrgSwitcher's tenant-switch
// flow (`onSuccess`) updates the cached token/current_tenant but never the
// cached `user` object, so a cached user role would silently go stale the
// moment someone switches tenants without a full re-login.
export function StaffPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const queryClient = useQueryClient();
  const staffQuery = useEventStaff(eventId);
  const zonesQuery = useEventZones(eventId);

  const activeTenant = getCurrentTenant();
  const tenantQuery = $api.useQuery(
    "get",
    "/api/tenants/{id}",
    { params: { path: { id: activeTenant?.id ?? "" } } },
    { enabled: activeTenant !== null },
  );
  const role = tenantQuery.data?.role;
  const isAdmin = role === "admin";
  const canManage = role === "admin" || role === "manager";

  // Session-only QR token cache, keyed by user id — Task 6's task brief is
  // explicit this must NEVER be persisted (localStorage would leak login
  // credentials): a QR token IS a bearer credential for event-day staff
  // login, no different from a password. Shared between every StaffCard
  // (a single-card regenerate populates it) and the "Print all" loop below
  // (which reuses whatever's already cached instead of redundantly
  // reissuing — reconciliation #13).
  const [tokens, setTokens] = React.useState<Map<string, string>>(() => new Map());
  // The single shared print sheet's cards — set by either a single card's
  // "Print card" action or by the "Print all" loop below; only one
  // #qr-print-root portal may exist at a time (QrPrintSheet.tsx), so this is
  // page-level state rather than something each StaffCard mounts itself.
  const [printCards, setPrintCards] = React.useState<QrPrintCard[] | null>(null);

  // Drives the shared AddStaffDialog instance mounted below — a single
  // page-level dialog (not one per row), matching the existing print-sheet
  // pattern above.
  const [addStaffOpen, setAddStaffOpen] = React.useState(false);

  const [printAllOpen, setPrintAllOpen] = React.useState(false);
  const [printAllBusy, setPrintAllBusy] = React.useState(false);
  const [printAllProgress, setPrintAllProgress] = React.useState<PrintAllProgress | null>(null);
  // Tracks FAILURES separately from printAllProgress.done (which counts
  // attempts, not successes) — P2.1's BulkBar/ImportWizard lesson: an
  // attempted-vs-succeeded distinction must survive into the final readout,
  // never silently counting a failure as "done".
  const [printAllFailedCount, setPrintAllFailedCount] = React.useState(0);
  const printAllSessionRef = React.useRef(0);
  const generateTokenForPrintAll = $api.useMutation("post", "/api/users/{id}/qr-token");

  const zoneNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of zonesQuery.data ?? []) {
      const identity = zoneIdentity(entry);
      map.set(identity.id, identity.name);
    }
    return map;
  }, [zonesQuery.data]);

  const staff = staffQuery.data ?? [];

  // Reports a freshly (re)generated token up to the shared cache AND
  // invalidates STAFF_KEY unconditionally (has_qr_token/qr_token_created_at
  // change on generation — mutation hygiene precedent) — called by every
  // StaffCard on a successful generate/regenerate, and by the "Print all"
  // loop below for each member it actually (re)generates.
  const handleTokenCached = React.useCallback((userId: string, token: string) => {
    setTokens((prev) => {
      const next = new Map(prev);
      next.set(userId, token);
      return next;
    });
    void queryClient.invalidateQueries({ queryKey: STAFF_KEY(eventId) });
  }, [queryClient, eventId]);

  const handleOpenPrintSheet = React.useCallback((card: QrPrintCard) => {
    setPrintCards([card]);
  }, []);

  function handlePrintAllOpenChange(open: boolean) {
    if (!open) {
      // Exhaustive busy-gating: the loop below awaits each mutation in
      // sequence, so backing out mid-way would leave an unknown split of
      // "already regenerated" vs "still on the old code" with no record of
      // which — same "genuinely still running" gate as BulkBar's batch
      // dialogs.
      if (printAllBusy) return;
      printAllSessionRef.current += 1;
      setPrintAllProgress(null);
      setPrintAllFailedCount(0);
    }
    setPrintAllOpen(open);
  }

  async function handleConfirmPrintAll() {
    const sessionId = printAllSessionRef.current;
    setPrintAllBusy(true);
    const total = staff.length;
    setPrintAllProgress({ done: 0, total });
    setPrintAllFailedCount(0);
    const successfulCards: QrPrintCard[] = [];
    let failedCount = 0;
    let attemptedGenerateAny = false;

    for (let i = 0; i < staff.length; i++) {
      // Unreachable via the UI while printAllBusy blocks dismissal above —
      // kept as defense-in-depth, same as BulkBar's equivalent loops.
      if (printAllSessionRef.current !== sessionId) break;
      const member = staff[i];
      const roleLabel = t(ROLE_LABEL_KEYS[member.role]);
      const zonesCaption = buildMemberZonesCaption(queryClient, member, zoneNameById, t);
      const existingToken = tokens.get(member.id);
      if (existingToken) {
        // Reconciliation #13: reuse this session's already-issued token
        // instead of redundantly regenerating (which would invalidate a
        // card that may have JUST been printed individually).
        successfulCards.push({
          email: member.email, roleLabel, zonesCaption, token: existingToken,
        });
      } else {
        attemptedGenerateAny = true;
        try {
          const response = await generateTokenForPrintAll.mutateAsync({ params: { path: { id: member.id } } });
          setTokens((prev) => {
            const next = new Map(prev);
            next.set(member.id, response.qr_token);
            return next;
          });
          successfulCards.push({
            email: member.email, roleLabel, zonesCaption, token: response.qr_token,
          });
        } catch {
          // Individual failures don't abort the batch — collected and
          // reported honestly below (attempt-vs-success, P2.1 lesson).
          failedCount += 1;
        }
      }
      if (printAllSessionRef.current === sessionId) {
        setPrintAllProgress({ done: i + 1, total });
        setPrintAllFailedCount(failedCount);
      }
    }

    if (attemptedGenerateAny) {
      // Cache correctness: at least one token really was (re)generated
      // server-side, so this runs unconditionally.
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY(eventId) });
    }
    setPrintAllBusy(false);
    if (failedCount > 0) {
      // Stay open — the final honest readout (staffPrintAllFailures) is the
      // confirmation the admin reads before closing it themselves, same as
      // BulkBar's assign-zone dialog.
    } else {
      // Bypasses handlePrintAllOpenChange (this isn't a dismiss path), so
      // its own reset is mirrored here — otherwise a later reopen would
      // briefly carry this run's now-irrelevant progress/failure counts
      // until the new run's first tick overwrites them.
      setPrintAllProgress(null);
      setPrintAllFailedCount(0);
      setPrintAllOpen(false);
    }
    if (successfulCards.length > 0) {
      setPrintCards(successfulCards);
    }
  }

  const printAllDescription = printAllBusy && printAllProgress
    ? t("staffPrintAllProgress", { done: printAllProgress.done, total: printAllProgress.total })
    : !printAllBusy && printAllFailedCount > 0
      ? t("staffPrintAllFailures", { failed: printAllFailedCount, total: printAllProgress?.total ?? staff.length })
      : t("staffPrintAllConfirmBody", { count: staff.length });

  const addStaffButton = canManage ? (
    <Button type="button" disabled={printAllBusy} onClick={() => setAddStaffOpen(true)}>{t("staffAdd")}</Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-page-title">{t("staffTitle")}</h2>
          {staffQuery.isLoading ? (
            <Skeleton className="h-4 w-8" data-testid="staff-total-skeleton" />
          ) : (
            <span className="font-mono text-caption text-muted-foreground">{staff.length}</span>
          )}
        </div>
        <span className="text-caption text-muted-foreground">{t("staffCaption")}</span>
        <div className="ml-auto flex items-center gap-2">
          {/* Reconciliation #15: "Print all" mirrors the per-card "Print
              card" restriction (admin-only) — always rendered, but disabled
              with a discoverable reason for anyone who will never be
              allowed to use it. PR #66 review (P2): also gated on BOTH
              queries having genuinely SUCCEEDED and the staff list being
              non-empty — the batch loop builds every card's zones caption
              from zoneNameById (zonesQuery.data ?? []), so starting it while
              zones are loading/errored would bake a false "No zones
              assigned" onto printed cards, and an unverified staff list
              would let a 0-member batch be confirmed. The title hint stays
              admin-only (the transient states need no permanent tooltip). */}
          <Button
            type="button"
            variant="outline"
            disabled={!isAdmin || printAllBusy || !staffQuery.isSuccess || !zonesQuery.isSuccess || staff.length === 0}
            title={!isAdmin ? t("staffPrintAllDisabledHint") : undefined}
            onClick={() => setPrintAllOpen(true)}
          >
            {t("staffPrintAll")}
          </Button>
          {/* "+ Add staff" hidden entirely for role staff (reconciliation
              #15) — not rendered disabled, since a plain staff member can
              never manage other staff, unlike the transiently-unwired
              Print action above. */}
          {addStaffButton}
        </div>
      </div>

      {staffQuery.isLoading ? (
        <StaffGridSkeleton />
      ) : staffQuery.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-6">
          <p className="text-body text-destructive">{t("staffLoadError")}</p>
          <Button type="button" variant="outline" onClick={() => staffQuery.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : staff.length === 0 ? (
        <EmptyState icon={Users} title={t("staffEmptyTitle")} description={t("staffEmptyBody")} actions={addStaffButton} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="staff-grid">
          {staff.map((member) => (
            <StaffCardRow
              key={member.id}
              user={member}
              eventId={eventId}
              zoneNameById={zoneNameById}
              zonesLoading={zonesQuery.isLoading}
              zonesError={zonesQuery.isError}
              isAdmin={isAdmin}
              canManage={canManage}
              cachedToken={tokens.get(member.id)}
              onTokenCached={handleTokenCached}
              onOpenPrintSheet={handleOpenPrintSheet}
              disabled={printAllBusy}
            />
          ))}
        </div>
      )}

      <div className="rounded-md border border-border p-3 text-caption text-muted-foreground">
        {t("staffFooterNote")}
      </div>

      <ConfirmDialog
        open={printAllOpen}
        onOpenChange={handlePrintAllOpenChange}
        title={t("staffPrintAll")}
        description={printAllDescription}
        confirmLabel={t("staffPrintAll")}
        cancelLabel={t("createEventCancel")}
        closeLabel={t("workspaceDialogClose")}
        confirmDisabled={printAllBusy}
        onConfirm={() => void handleConfirmPrintAll()}
      />

      {printCards ? (
        <QrPrintSheet cards={printCards} onAfterPrint={() => setPrintCards(null)} />
      ) : null}

      <AddStaffDialog eventId={eventId} open={addStaffOpen} onOpenChange={setAddStaffOpen} isAdmin={isAdmin} />
    </div>
  );
}

interface StaffCardRowProps {
  user: StaffUser;
  eventId: string;
  zoneNameById: Map<string, string>;
  zonesLoading: boolean;
  zonesError: boolean;
  isAdmin: boolean;
  canManage: boolean;
  cachedToken: string | undefined;
  onTokenCached: (userId: string, token: string) => void;
  onOpenPrintSheet: (card: QrPrintCard) => void;
  disabled: boolean;
}

// Owns the one per-card hook call (`useUserZoneAssignments`) so StaffCard
// itself can stay purely presentational — one instance is mounted per staff
// member (keyed by user.id in the .map() above), which is what makes calling
// a hook once per card valid despite the card count varying with the staff
// list (each card is its own component instance, not a loop inside one).
function StaffCardRow({
  user, eventId, zoneNameById, zonesLoading, zonesError, isAdmin, canManage, cachedToken, onTokenCached, onOpenPrintSheet, disabled,
}: StaffCardRowProps) {
  const assignmentsQuery = useUserZoneAssignments(user.id);

  let zoneNames: string[] | "loading" | "error";
  if (assignmentsQuery.isLoading || zonesLoading) {
    zoneNames = "loading";
  } else if (assignmentsQuery.isError || zonesError) {
    zoneNames = "error";
  } else {
    // Final-review Finding 2: GET /api/users/{user_id}/zones is TENANT-wide
    // (the backend filters by user_id only, not by event), and
    // staff_zone_assignments.zone_id has ON DELETE CASCADE — so an
    // assignment whose zone_id is NOT in THIS event's zoneNameById belongs
    // to some OTHER event in the same tenant, not a deleted zone (that case
    // is unreachable: the row would have been cascade-deleted along with
    // the zone). Such foreign ids are filtered out entirely rather than
    // rendered as a hex-sliced id, which would be neither honest (it reads
    // as if it were this event's own zone) nor useful to the viewer.
    zoneNames = (assignmentsQuery.data ?? [])
      .filter((assignment) => zoneNameById.has(assignment.zone_id))
      .map((assignment) => zoneNameById.get(assignment.zone_id)!);
  }

  return (
    <StaffCard
      user={user}
      zoneNames={zoneNames}
      eventId={eventId}
      isAdmin={isAdmin}
      canManage={canManage}
      cachedToken={cachedToken}
      onTokenCached={onTokenCached}
      onOpenPrintSheet={onOpenPrintSheet}
      disabled={disabled}
    />
  );
}

function StaffGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="staff-grid-skeleton">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
