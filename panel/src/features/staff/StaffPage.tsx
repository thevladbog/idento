import {
  Button, EmptyState, Skeleton,
} from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { Users } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { StaffCard } from "./StaffCard";
import { useEventStaff, useUserZoneAssignments } from "./hooks";
import type { StaffUser } from "./hooks";
import { useEventZones } from "../attendees/hooks";
import { $api } from "../../shared/api/query";
import { getCurrentTenant } from "../../shared/api/session";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";

// Same rationale as AttendeesPage.tsx / ZonesPage.tsx / EventWorkspaceLayout.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/staff");

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

  const zoneNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of zonesQuery.data ?? []) {
      const identity = zoneIdentity(entry);
      map.set(identity.id, identity.name);
    }
    return map;
  }, [zonesQuery.data]);

  const staff = staffQuery.data ?? [];

  const addStaffButton = canManage ? (
    <Button type="button">{t("staffAdd")}</Button>
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
              allowed to use it, even once Task 6 wires the real handler. */}
          <Button
            type="button"
            variant="outline"
            disabled={!isAdmin}
            title={!isAdmin ? t("staffPrintAllDisabledHint") : undefined}
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
              zoneNameById={zoneNameById}
              zonesLoading={zonesQuery.isLoading}
              zonesError={zonesQuery.isError}
              isAdmin={isAdmin}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      <div className="rounded-md border border-border p-3 text-caption text-muted-foreground">
        {t("staffFooterNote")}
      </div>
    </div>
  );
}

interface StaffCardRowProps {
  user: StaffUser;
  zoneNameById: Map<string, string>;
  zonesLoading: boolean;
  zonesError: boolean;
  isAdmin: boolean;
  canManage: boolean;
}

// Owns the one per-card hook call (`useUserZoneAssignments`) so StaffCard
// itself can stay purely presentational — one instance is mounted per staff
// member (keyed by user.id in the .map() above), which is what makes calling
// a hook once per card valid despite the card count varying with the staff
// list (each card is its own component instance, not a loop inside one).
function StaffCardRow({
  user, zoneNameById, zonesLoading, zonesError, isAdmin, canManage,
}: StaffCardRowProps) {
  const assignmentsQuery = useUserZoneAssignments(user.id);

  let zoneNames: string[] | "loading" | "error";
  if (assignmentsQuery.isLoading || zonesLoading) {
    zoneNames = "loading";
  } else if (assignmentsQuery.isError || zonesError) {
    zoneNames = "error";
  } else {
    zoneNames = (assignmentsQuery.data ?? []).map(
      // Falls back to a short id slice (never a fabricated name) if a
      // zone was deleted after the assignment was made — same fallback
      // AttendeeDrawer.tsx uses for the same "stale id, zone gone" case.
      (assignment) => zoneNameById.get(assignment.zone_id) ?? assignment.zone_id.slice(0, 8),
    );
  }

  return (
    <StaffCard
      user={user}
      zoneNames={zoneNames}
      isAdmin={isAdmin}
      canManage={canManage}
      onPrint={() => {}}
      onZones={() => {}}
      onRevoke={() => {}}
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
