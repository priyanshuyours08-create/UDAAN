import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { AccessDeniedPage } from '../pages/auth/AccessDeniedPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { MainLayout } from '../components/layout/MainLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { RoleProtectedRoute } from './RoleProtectedRoute';

// Dashboards
import { ApplicantDashboard } from '../pages/applicant/ApplicantDashboard';
import { OfficerDashboard } from '../pages/officer/OfficerDashboard';
import { InspectorDashboard } from '../pages/inspector/InspectorDashboard';
import { AdminDashboard } from '../pages/admin/AdminDashboard';

export const AppRoutes = () => {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={user ? <Navigate to={`/${user.role}`} replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to={`/${user.role}`} replace /> : <RegisterPage />} />
      <Route path="/403" element={<AccessDeniedPage />} />

      {/* Root redirect */}
      <Route
        path="/"
        element={
          user ? <Navigate to={`/${user.role}`} replace /> : <Navigate to="/login" replace />
        }
      />

      {/* Protected Routes with MainLayout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>

          {/* Applicant Routes */}
          <Route element={<RoleProtectedRoute allowedRoles={['applicant']} />}>
            <Route path="/applicant" element={<ApplicantDashboard />} />
            <Route path="/applicant/*" element={<ApplicantDashboard />} />
          </Route>

          {/* Officer Routes */}
          <Route element={<RoleProtectedRoute allowedRoles={['officer']} />}>
            <Route path="/officer" element={<OfficerDashboard />} />
            <Route path="/officer/*" element={<OfficerDashboard />} />
          </Route>

          {/* Inspector Routes */}
          <Route element={<RoleProtectedRoute allowedRoles={['inspector']} />}>
            <Route path="/inspector" element={<InspectorDashboard />} />
            <Route path="/inspector/*" element={<InspectorDashboard />} />
          </Route>

          {/* Admin Routes */}
          <Route element={<RoleProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/*" element={<AdminDashboard />} />
          </Route>

        </Route>
      </Route>

      {/* Catch all */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
};
