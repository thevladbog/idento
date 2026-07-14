import { Navigate, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { hasSession } from "../../shared/api/session";

// eslint-disable-next-line react-refresh/only-export-components -- Route guard function belongs with the layout component it guards; not a real Fast Refresh issue for this pattern.
export function protectedBeforeLoad() {
  if (!hasSession()) {
    throw redirect({ to: "/login" });
  }
}

export function ProtectedLayout() {
  if (!hasSession()) {
    return <Navigate to="/login" />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
