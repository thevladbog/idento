import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { LoginScreen } from "../features/auth/LoginScreen";
import { QrLoginScreen } from "../features/auth/QrLoginScreen";
import { RegisterScreen } from "../features/auth/RegisterScreen";
import { ProtectedLayout, protectedBeforeLoad } from "./shell/ProtectedLayout";
import {
  EventWorkspaceLayout, WorkspaceSettingsPlaceholder,
} from "../features/workspace/EventWorkspaceLayout";
import { HomePage } from "../features/home/HomePage";
import { WorkspaceOverview } from "../features/workspace/WorkspaceOverview";
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
  component: () => <PlaceholderPage titleKey="navOrganization" />,
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
  component: WorkspaceSettingsPlaceholder, // Task 4 swaps to EventSettingsPage
});

const routeTree = rootRoute.addChildren([
  protectedLayoutRoute.addChildren([
    indexRoute,
    teamRoute,
    equipmentRoute,
    organizationRoute,
    eventWorkspaceRoute.addChildren([eventOverviewRoute, eventSettingsRoute]),
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
