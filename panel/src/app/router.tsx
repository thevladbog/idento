import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LoginScreen } from "../features/auth/LoginScreen";
import { QrLoginScreen } from "../features/auth/QrLoginScreen";
import { RegisterScreen } from "../features/auth/RegisterScreen";
import { ProtectedLayout, protectedBeforeLoad } from "./shell/ProtectedLayout";
import { PlaceholderPage } from "../shared/ui/PlaceholderPage";
import { getInstance } from "../shared/api/client";
import { queryClient } from "./queryClient";

export const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// eslint-disable-next-line react-refresh/only-export-components -- Route component belongs next to the route definitions it backs; not a real Fast Refresh issue for this pattern (same rationale as ProtectedLayout.tsx / ThemeProvider.tsx).
function HomePlaceholder() {
  const { t } = useTranslation();
  return <div className="p-6 text-body">{t("homeComingSoon")}</div>;
}

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
    const instance = await queryClient.ensureQueryData({
      queryKey: ["instance"],
      queryFn: getInstance,
      staleTime: Infinity,
    });
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
  // P1 replaces this with the real Home (board 1c) — the shell and routing
  // guard are this phase's deliverable, not Home's content.
  component: HomePlaceholder,
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

const routeTree = rootRoute.addChildren([
  protectedLayoutRoute.addChildren([indexRoute, teamRoute, equipmentRoute, organizationRoute]),
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
