import { Navigate, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { hasSession } from "../../shared/api/session";
import { SuspendedScreen } from "../../features/tenant-suspended/SuspendedScreen";
import { useTenantSuspended } from "../../shared/tenant-status/useTenantSuspended";

// eslint-disable-next-line react-refresh/only-export-components -- Route guard function belongs with the layout component it guards; not a real Fast Refresh issue for this pattern.
export function protectedBeforeLoad() {
  if (!hasSession()) {
    throw redirect({ to: "/login" });
  }
}

export function ProtectedLayout() {
  const suspended = useTenantSuspended();
  if (!hasSession()) {
    return <Navigate to="/login" />;
  }
  if (suspended) {
    return <SuspendedScreen />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
