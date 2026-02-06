import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import QRLoginPage from "./pages/QRLogin";
import Dashboard from "./pages/Dashboard";
import EventsPage from "./pages/Events";
import EventLayout from "./pages/event/EventLayout";
import EventAttendees from "./pages/event/EventAttendees";
import EventZones from "./pages/event/EventZones";
import EventStaff from "./pages/event/EventStaff";
import EventCheckin from "./pages/event/EventCheckin";
import EventSettings from "./pages/event/EventSettings";
import BadgeTemplateEditorV2 from "./pages/BadgeTemplateEditorV2";
import UsersPage from "./pages/Users";
import CheckinSelectEvent from "./pages/CheckinSelectEvent";
import CheckinFullscreenPage from "./pages/CheckinFullscreen";
import EquipmentSettingsPage from "./pages/EquipmentSettings";
import OrganizationSettings from "./pages/OrganizationSettings";
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
      return <Navigate to="/dashboard" replace />;
    }
  }
  
  return children;
}

function App() {
  // Dynamic favicon based on language
  useFavicon();

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/qr-login" element={<QRLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/events"
          element={
            <ProtectedRoute>
              <EventsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/events/:eventId"
          element={
            <ProtectedRoute>
              <EventLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<EventAttendees />} />
          <Route path="zones" element={<EventZones />} />
          <Route path="template" element={<BadgeTemplateEditorV2 />} />
          <Route path="staff" element={<EventStaff />} />
          <Route path="checkin" element={<EventCheckin />} />
          <Route path="settings" element={<EventSettings />} />
        </Route>
        <Route
          path="/users"
          element={
            <ProtectedRoute>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin"
          element={
            <ProtectedRoute>
              <CheckinSelectEvent />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin-fullscreen"
          element={
            <ProtectedRoute>
              <CheckinFullscreenPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/equipment"
          element={
            <ProtectedRoute>
              <EquipmentSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/organization"
          element={
            <ProtectedRoute>
              <OrganizationSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/super-admin"
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
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
