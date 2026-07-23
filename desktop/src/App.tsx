import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AgentLifecycle } from "./components/AgentLifecycle";
import LoginPage from "./pages/Login";
import QRLoginPage from "./pages/QRLogin";
import ConnectionPage from "./pages/Connection";
import EquipmentPage from "./pages/Equipment";
import CheckinPage from "./pages/Checkin";
import ModePage from "./pages/Mode";
import RunPage from "./pages/Run";
import SelfServicePage from "./pages/SelfService";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <AgentLifecycle />
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/qr-login" element={<QRLoginPage />} />
        <Route path="/connection" element={<ConnectionPage />} />
        <Route
          path="/checkin"
          element={
            <ProtectedRoute>
              <CheckinPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/equipment"
          element={
            <ProtectedRoute>
              <EquipmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/mode"
          element={
            <ProtectedRoute>
              <ModePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/self"
          element={
            <ProtectedRoute>
              <SelfServicePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId"
          element={
            <ProtectedRoute>
              <RunPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
