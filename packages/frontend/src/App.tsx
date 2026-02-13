import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Metrics } from './pages/Metrics';
import { LiveMetrics } from './pages/LiveMetrics';
import { DetailedUsage } from './pages/DetailedUsage';
import { Usage } from './pages/Usage';
import { Performance } from './pages/Performance';
import { Logs } from './pages/Logs';
import { Providers } from './pages/Providers';
import { Models } from './pages/Models';
import { Keys } from './pages/Keys';
import { Config } from './pages/Config';
import { SystemLogs } from './pages/SystemLogs';
import { Debug } from './pages/Debug';
import { Errors } from './pages/Errors';
import { Quotas } from './pages/Quotas';
import { McpPage } from './pages/Mcp';
import { Login } from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SidebarProvider } from './contexts/SidebarContext';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { adminKey } = useAuth();
  const location = useLocation();

  // If we have an admin key (or we might need to check with server if valid, but for now client-side check is fine per plan)
  // However, since we default to null, we might redirect too early if init is slow. 
  // But our init is synchronous from localStorage.

  // Note: If the backend is NOT configured with an admin key, the API will work without one.
  // But the frontend will force a login if we strictly check 'adminKey'.
  // This creates a UX issue where users MUST set a key to use the UI if we strictly block here.
  
  // Strategy:
  // Since we can't know if the backend REQUIRES auth without asking it,
  // we could just let them pass if they have a key OR if we want to be "open by default" in UI.
  // But the user request implies "Protection".
  // So: If the user explicitly logs out or has no key, show Login. 
  // If they don't have a key set in backend, they can enter anything or blank? 
  // Actually, if backend has no key, x-admin-key header is ignored.
  // So users can enter "dummy" to pass this UI check. 
  // Better: We should probably try to see if we are authorized.
  
  // For this iteration, let's strictly require a key in UI if they want to access protected routes,
  // effectively enforcing "You must login". If backend is open, any key works.
  
  if (!adminKey) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/*" element={
                <ProtectedRoute>
                    <MainLayout>
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/metrics" element={<Metrics />} />
                            <Route path="/live-metrics" element={<LiveMetrics />} />
                            <Route path="/detailed-usage" element={<DetailedUsage />} />
                            <Route path="/usage" element={<Usage />} />
                            <Route path="/performance" element={<Performance />} />
                            <Route path="/logs" element={<Logs />} />
                            <Route path="/providers" element={<Providers />} />
                            <Route path="/models" element={<Models />} />
                            <Route path="/keys" element={<Keys />} />
                            <Route path="/config" element={<Config />} />
                            <Route path="/system-logs" element={<SystemLogs />} />
                            <Route path="/debug" element={<Debug />} />
                            <Route path="/errors" element={<Errors />} />
                            <Route path="/quotas" element={<Quotas />} />
                            <Route path="/mcp" element={<McpPage />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </MainLayout>
                </ProtectedRoute>
            } />
        </Routes>
    );
}

const App = () => {
  return (
    <AuthProvider>
      <SidebarProvider>
        <AppRoutes />
      </SidebarProvider>
    </AuthProvider>
  );
};

export default App;
