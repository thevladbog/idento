import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { LoginScreen } from "../features/auth/LoginScreen";
import { QrLoginScreen } from "../features/auth/QrLoginScreen";
import { RegisterScreen } from "../features/auth/RegisterScreen";
import { ProtectedLayout, protectedBeforeLoad } from "./shell/ProtectedLayout";
import { EventWorkspaceLayout } from "../features/workspace/EventWorkspaceLayout";
import { AttendeesPage } from "../features/attendees/AttendeesPage";
import { validateAttendeesSearch } from "../features/attendees/searchParams";
import { HomePage } from "../features/home/HomePage";
import { ZonesPage } from "../features/zones/ZonesPage";
import { StaffPage } from "../features/staff/StaffPage";
import { WorkspaceOverview } from "../features/workspace/WorkspaceOverview";
import { EventSettingsPage } from "../features/workspace/settings/EventSettingsPage";
import { BadgeEditorPage } from "../features/badge/BadgeEditorPage";
import { OrganizationPage } from "../features/organization/OrganizationPage";
import { StationPage } from "../features/checkin/StationPage";
import { checkinStationBeforeLoad, validateCheckinStationSearch } from "../features/checkin/searchParams";
import { PlaceholderPage } from "../shared/ui/PlaceholderPage";
import { getInstance } from "../shared/api/client";
import { queryClient } from "./queryClient";

export const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginScreen,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  // Carried forward from Task 7 — do NOT drop this guard when rebuilding
  // the route tree. On-prem never mounts POST /auth/register server-side;
  // this redirects before the form even renders (LoginScreen separately
  // hides the link to get here).
  beforeLoad: async () => {
    let instance;
    try {
      instance = await queryClient.ensureQueryData({
        queryKey: ["instance"],
        queryFn: getInstance,
        staleTime: Infinity,
      });
    } catch {
      // Network/5xx failure: fail closed to the safe default (treat as
      // non-saas) instead of surfacing an unhandled error state that would
      // bypass this SaaS-only guard.
      throw redirect({ to: "/login" });
    }
    if (instance.mode !== "saas") {
      throw redirect({ to: "/login" });
    }
  },
  component: RegisterScreen,
});

const qrLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qr-login",
  component: QrLoginScreen,
});

const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  beforeLoad: protectedBeforeLoad,
  component: ProtectedLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/",
  component: HomePage,
});

const teamRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/team",
  component: () => <PlaceholderPage titleKey="navTeam" />,
});

const equipmentRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/equipment",
  component: () => <PlaceholderPage titleKey="navEquipment" />,
});

const organizationRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/organization",
  component: OrganizationPage,
});

const eventWorkspaceRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/events/$eventId",
  component: EventWorkspaceLayout,
});

const eventOverviewRoute = createRoute({
  getParentRoute: () => eventWorkspaceRoute,
  path: "/",
  component: WorkspaceOverview,
});

const eventSettingsRoute = createRoute({
  getParentRoute: () => eventWorkspaceRoute,
  path: "/settings",
  component: EventSettingsPage,
});

const eventAttendeesRoute = createRoute({
  getParentRoute: () => eventWorkspaceRoute,
  path: "/attendees",
  validateSearch: validateAttendeesSearch,
  component: AttendeesPage,
});

const eventZonesRoute = createRoute({
  getParentRoute: () => eventWorkspaceRoute,
  path: "/zones",
  component: ZonesPage,
});

const eventStaffRoute = createRoute({
  getParentRoute: () => eventWorkspaceRoute,
  path: "/staff",
  component: StaffPage,
});

const eventBadgeRoute = createRoute({
  getParentRoute: () => eventWorkspaceRoute,
  path: "/badge",
  component: BadgeEditorPage,
});

// P4.1 Task 8 -- the check-in station. A TOP-LEVEL protected route, a
// SIBLING of eventWorkspaceRoute (registered directly under
// protectedLayoutRoute.addChildren below, NOT nested inside
// eventWorkspaceRoute.addChildren) so it renders WITHOUT the workspace
// rail shell (WorkspaceRail/EventWorkspaceLayout) -- a near-fullscreen
// screen for event-day check-in, not another workspace tab. See
// features/checkin/searchParams.ts for the `?station=` validation +
// beforeLoad guard this route shares with StationPage.test.tsx's own
// routed harness.
const eventCheckinRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/events/$eventId/checkin",
  validateSearch: validateCheckinStationSearch,
  beforeLoad: checkinStationBeforeLoad,
  component: StationPage,
});

const routeTree = rootRoute.addChildren([
  protectedLayoutRoute.addChildren([
    indexRoute,
    teamRoute,
    equipmentRoute,
    organizationRoute,
    eventWorkspaceRoute.addChildren([
      eventOverviewRoute, eventSettingsRoute, eventAttendeesRoute, eventZonesRoute, eventStaffRoute, eventBadgeRoute,
    ]),
    eventCheckinRoute,
  ]),
  loginRoute,
  registerRoute,
  qrLoginRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
