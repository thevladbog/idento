import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/Login";
import SuperAdminLayout from "./pages/super-admin/SuperAdminLayout";
import SuperAdminDashboard from "./pages/super-admin/Dashboard";
import Organizations from "./pages/super-admin/Organizations";
import OrganizationDetail from "./pages/super-admin/OrganizationDetail";
import SubscriptionPlans from "./pages/super-admin/SubscriptionPlans";
import AllUsers from "./pages/super-admin/AllUsers";
import Analytics from "./pages/super-admin/Analytics";
import AuditLog from "./pages/super-admin/AuditLog";
import { Toaster } from "sonner";
import { useFavicon } from "./hooks/useFavicon";
import "./i18n";

function ProtectedRoute({ children, requireSuperAdmin }: { children: JSX.Element, requireSuperAdmin?: boolean }) {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (requireSuperAdmin) {
    const user = JSON.parse(localStorage.getItem("user") || '{}');
    if (!user.is_super_admin) {
      // This console only serves the super-admin surface now — there is no
      // "/dashboard" route to send a non-super-admin user to.
      return <Navigate to="/login" replace />;
    }
  }

  return children;
}

function App() {
  // Dynamic favicon based on language
  useFavicon();

  return (
    <BrowserRouter basename="/super-admin">
      <Toaster position="top-right" richColors />
      <Routes>
        {/* Console's own login (super-admin entry point) → /super-admin/login */}
        <Route path="/login" element={<LoginPage />} />
        {/* Console (was /super-admin/*, now the app root under basename) */}
        <Route
          path="/"
          element={
            <ProtectedRoute requireSuperAdmin>
              <SuperAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SuperAdminDashboard />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="organizations/:id" element={<OrganizationDetail />} />
          <Route path="users" element={<AllUsers />} />
          <Route path="plans" element={<SubscriptionPlans />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit" element={<AuditLog />} />
        </Route>
        {/* Unknown → console dashboard (ProtectedRoute redirects to /login if
            unauthenticated, same guard as before) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
