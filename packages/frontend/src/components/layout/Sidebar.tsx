import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, Settings, Server, Box, FileText, Bug, Database, LogOut, AlertTriangle, Key, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import logo from '../../assets/plexus_logo_transparent.png';

export const Sidebar: React.FC = () => {
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { logout } = useAuth();

  useEffect(() => {
    api.getDebugMode().then(setDebugMode);
  }, []);

  const handleToggleClick = () => {
      setShowConfirm(true);
  };

  const confirmToggle = async () => {
      try {
          const newState = await api.setDebugMode(!debugMode);
          setDebugMode(newState);
      } catch (e) {
          console.error("Failed to toggle debug mode", e);
      } finally {
          setShowConfirm(false);
      }
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/ui/login';
  };

  return (
    <aside className="w-[200px] h-screen fixed left-0 top-0 bg-bg-surface flex flex-col overflow-y-auto z-50 transition-transform duration-300 border-r border-border">
      <div className="px-5 py-6 border-b border-border">
        <div className="flex items-center gap-3 mb-1">
          <img src={logo} alt="Plexus" className="w-8 h-8" />
          <h1 className="font-heading text-xl font-bold m-0 bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary">Plexus</h1>
        </div>
        <p className="text-xs text-text-muted mt-1">AI Infrastructure Management</p>
      </div>

      <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
        <NavLink to="/" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/usage" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
          <Activity size={20} />
          <span>Usage</span>
        </NavLink>
        <NavLink to="/logs" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
          <FileText size={20} />
          <span>Logs</span>
        </NavLink>

        <div className="mt-6 px-2">
            <h3 className="font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Configuration</h3>
            <NavLink to="/providers" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
            <Server size={20} />
            <span>Providers</span>
            </NavLink>
            <NavLink to="/models" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
            <Box size={20} />
            <span>Models</span>
            </NavLink>
            <NavLink to="/keys" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
            <Key size={20} />
            <span>Keys</span>
            </NavLink>
            <NavLink to="/oauth" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
            <Shield size={20} />
            <span>OAuth</span>
            </NavLink>
             <NavLink to="/config" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
            <Settings size={20} />
            <span>Settings</span>
            </NavLink>
            <NavLink to="/system-logs" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')}>
            <FileText size={20} />
            <span>System Logs</span>
            </NavLink>
        </div>

        <div className="mt-6 px-2 mt-auto">
            <h3 className="font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">System</h3>
            <button
                onClick={handleToggleClick}
                className={clsx(
                    "flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover w-full justify-start bg-transparent",
                    debugMode ? "text-danger border-danger/30 shadow-sm bg-[rgba(239,68,68,0.1)] shadow-[0_2px_8px_rgba(239,68,68,0.15)] hover:bg-[rgba(239,68,68,0.15)]" : "text-text-secondary hover:text-text"
                )}
                style={{ marginBottom: '8px' }}
             >
                <Bug size={20} />
                <span>{debugMode ? 'Debug Mode: On' : 'Debug Mode: Off'}</span>
             </button>
            <NavLink to="/debug" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')} style={{ marginBottom: '8px' }}>
                <Database size={20} />
                <span>Debug Traces</span>
            </NavLink>
            <NavLink to="/errors" className={({ isActive }) => clsx('flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text', isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]')} style={{ marginBottom: '8px' }}>
                <AlertTriangle size={20} />
                <span>Errors</span>
            </NavLink>
             <button
                onClick={handleLogout}
                className="flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent text-danger w-full bg-transparent border-transparent justify-start hover:text-danger hover:border-danger/30 hover:bg-red-500/10 mt-4"
             >
                <LogOut size={20} />
                <span>Logout</span>
             </button>
        </div>
      </nav>
      
      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={debugMode ? "Disable Debug Mode?" : "Enable Debug Mode?"}
        footer={
            <>
                <Button variant="secondary" onClick={() => setShowConfirm(false)}>Cancel</Button>
                <Button variant={debugMode ? "primary" : "danger"} onClick={confirmToggle}>
                    {debugMode ? "Disable" : "Enable"}
                </Button>
            </>
        }
      >
        <p>
            {debugMode 
                ? "Disabling debug mode will stop capturing full request/response payloads." 
                : "Enabling debug mode will capture FULL raw request and response payloads, including personal data if present. This can consume significant storage."}
        </p>
      </Modal>
    </aside>
  );
};
