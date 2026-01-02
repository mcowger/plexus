import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, Settings, Server, Box, FileText, Bug, Database, LogOut } from 'lucide-react';
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
    window.location.href = '/login';
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <img src={logo} alt="Plexus" style={{ width: '32px', height: '32px' }} />
          <h1 className="sidebar-title">Plexus</h1>
        </div>
        <p className="sidebar-subtitle">AI Infrastructure Management</p>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" className={({ isActive }) => clsx('nav-item', isActive && 'active')}>
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/usage" className={({ isActive }) => clsx('nav-item', isActive && 'active')}>
          <Activity size={20} />
          <span>Usage</span>
        </NavLink>
        <NavLink to="/logs" className={({ isActive }) => clsx('nav-item', isActive && 'active')}>
          <FileText size={20} />
          <span>Logs</span>
        </NavLink>
        
        <div className="nav-section">
            <h3 className="nav-section-title">Configuration</h3>
            <NavLink to="/providers" className={({ isActive }) => clsx('nav-item', isActive && 'active')}>
            <Server size={20} />
            <span>Providers</span>
            </NavLink>
            <NavLink to="/models" className={({ isActive }) => clsx('nav-item', isActive && 'active')}>
            <Box size={20} />
            <span>Models</span>
            </NavLink>
             <NavLink to="/config" className={({ isActive }) => clsx('nav-item', isActive && 'active')}>
            <Settings size={20} />
            <span>Settings</span>
            </NavLink>
        </div>

        <div className="nav-section mt-auto">
            <h3 className="nav-section-title">System</h3>
            <NavLink to="/debug" className={({ isActive }) => clsx('nav-item mb-2', isActive && 'active')}>
                <Database size={20} />
                <span>Debug Traces</span>
            </NavLink>
            <button 
                onClick={handleToggleClick}
                className={clsx(
                    "nav-item debug-btn",
                    debugMode && "active"
                )}
             >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Bug size={20} />
                    <span>Debug Mode</span>
                </div>
                <span className="debug-status">
                    {debugMode ? 'Enabled' : 'Disabled'}
                </span>
             </button>
             <button 
                onClick={handleLogout}
                className="nav-item nav-item-danger mt-4"
             >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <LogOut size={20} />
                    <span>Logout</span>
                </div>
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
