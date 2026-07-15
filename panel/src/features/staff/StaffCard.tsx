import {
  Avatar, AvatarFallback, Button, Card, Skeleton,
} from "@idento/ui";
import { useTranslation } from "react-i18next";
import type { StaffUser } from "./hooks";

export interface StaffCardProps {
  user: StaffUser;
  // Resolved by the caller (StaffPage's per-row wrapper, which joins
  // useUserZoneAssignments(user.id) against the event's plain zones list) —
  // this component is purely presentational and never fetches anything
  // itself. "loading"/"error" are distinct terminal states, never collapsed
  // into an empty array (P2.1 honesty rule: an error must never render as
  // "no zones").
  zoneNames: string[] | "loading" | "error";
  onPrint: () => void;
  onZones: () => void;
  onRevoke: () => void;
  // Mirrors StaffPage's header gating (the caller's role in the active
  // tenant, fetched live — see StaffPage.tsx): printing a QR card is
  // admin-only (same restriction as the header's "Print all QR cards"),
  // while the Zones/Revoke actions are available to admin OR manager.
  // Task 5 renders every action disabled regardless of role (no handlers
  // wired yet — Tasks 6-7 own that); these two booleans currently only
  // control which actions are even offered on the card at all, not their
  // (always-disabled) enabled state.
  isAdmin: boolean;
  canManage: boolean;
}

// Board §5 "Staff card anatomy": circular initials avatar + name + role/
// station subtitle + sign-in status + QR card visual + action row. Only the
// avatar/email/role-subtitle/zones-caption/action-row pieces are real here —
// reconciliations #9-10 established there is no "signed in" data source and
// no station field on the User resource at all, so that row and the QR
// card visual (Task 6) are simply not rendered by this task's card.
const ROLE_LABEL_KEYS: Record<StaffUser["role"], string> = {
  admin: "staffRoleAdmin",
  manager: "staffRoleManager",
  staff: "staffRoleStaff",
};

// First two characters of the email's local part (before "@"), uppercased —
// there is no name field on User to derive real initials from.
function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

export function StaffCard({
  user, zoneNames, onPrint, onZones, onRevoke, isAdmin, canManage,
}: StaffCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center gap-2.5">
        <Avatar className="size-[30px]">
          <AvatarFallback className="bg-success/10 text-caption font-semibold text-success">
            {emailInitials(user.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="text-body font-bold">{user.email}</span>
          <span className="text-caption text-muted-foreground">{t(ROLE_LABEL_KEYS[user.role])}</span>
        </div>
      </div>

      {zoneNames === "loading" ? (
        <Skeleton className="h-4 w-40" data-testid="staff-zones-skeleton" />
      ) : zoneNames === "error" ? (
        <span className="text-caption text-destructive">{t("staffZonesError")}</span>
      ) : zoneNames.length === 0 ? (
        <span className="text-caption text-muted-foreground">{t("staffZonesNone")}</span>
      ) : (
        <span className="font-mono text-caption text-muted-foreground">
          {t("staffZonesCaption", { zones: zoneNames.join(", ") })}
        </span>
      )}

      {canManage ? (
        <div className="flex items-center gap-3">
          {isAdmin ? (
            <Button
              type="button"
              variant="link"
              disabled
              onClick={onPrint}
              className="h-auto p-0 text-caption text-success hover:no-underline"
            >
              {t("staffActionPrint")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="link"
            disabled
            onClick={onZones}
            className="h-auto p-0 text-caption text-muted-foreground hover:no-underline"
          >
            {t("staffActionZones")}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled
            onClick={onRevoke}
            className="ml-auto h-auto p-0 text-caption text-destructive hover:no-underline"
          >
            {t("staffActionRevoke")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
