import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./components/theme-provider";
import { AuthProvider } from "./contexts/AuthContext";
import { SidebarProvider } from "./contexts/SidebarContext";
import { ProtectedRoute } from "./contexts/ProtectedRoute";
import { MainLayout } from "./components/layout/MainLayout";
import { Toaster } from "sonner";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { UsagePage } from "./pages/Usage";
import { LogsPage } from "./pages/Logs";
import { ProvidersPage } from "./pages/Providers";
import { ModelsPage } from "./pages/Models";
import { KeysPage } from "./pages/Keys";
import { ConfigPage } from "./pages/Config";
import { SystemPage } from "./pages/System";
import { DebugPage } from "./pages/Debug";
import { ErrorsPage } from "./pages/Errors";
import { NotFoundPage } from "./pages/NotFound";

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SidebarProvider>
            <Toaster />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <DashboardPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/usage"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <UsagePage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/logs"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <LogsPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/providers"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <ProvidersPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/models"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <ModelsPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/keys"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <KeysPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/config"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <ConfigPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/system"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <SystemPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/debug"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <DebugPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/errors"
                element={
                  <ProtectedRoute>
                    <MainLayout>
                      <ErrorsPage />
                    </MainLayout>
                  </ProtectedRoute>
                }
              />
              <Route path="/404" element={<NotFoundPage />} />
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
          </SidebarProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
