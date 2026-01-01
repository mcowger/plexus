import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Usage } from './pages/Usage';
import { Logs } from './pages/Logs';
import { Providers } from './pages/Providers';
import { Models } from './pages/Models';
import { Config } from './pages/Config';
import { Debug } from './pages/Debug';

const App = () => {
  return (
    <MainLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/models" element={<Models />} />
          <Route path="/config" element={<Config />} />
          <Route path="/debug" element={<Debug />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </MainLayout>
  );
};

export default App;
