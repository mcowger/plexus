import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, Settings, Server, Box, FileText, Bug, Database, LogOut, AlertTriangle, Key, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import logo from '../../assets/plexus_logo_transparent.png';

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ size: number }>;
  label: string;
  isCollapsed: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, isCollapsed }) => {
  const navLink = (
    <NavLink
      to={to}
      className={({ isActive }) => clsx(
        'flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text',
        isCollapsed && 'justify-center',
        isActive && 'bg-bg-glass text-primary border-border-glass shadow-sm backdrop-blur-md shadow-[0_2px_8px_rgba(245,158,11,0.15)]'
      )}
    >
      <Icon size={20} />
      <span className={clsx(
        "transition-opacity duration-200",
        isCollapsed && "opacity-0 w-0 overflow-hidden"
      )}>
        {label}
      </span>
    </NavLink>
  );

  return isCollapsed ? (
    <Tooltip content={label} position="right">
      {navLink}
    </Tooltip>
  ) : navLink;
};

export const Sidebar: React.FC = () => {
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { logout } = useAuth();
  const { isCollapsed, toggleSidebar } = useSidebar();

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
    <aside className={clsx(
      "h-screen fixed left-0 top-0 bg-bg-surface flex flex-col overflow-y-auto overflow-x-hidden z-50 transition-all duration-300 border-r border-border",
      isCollapsed ? "w-[64px]" : "w-[200px]"
    )}>
      <div className="px-5 py-6 border-b border-border flex items-center justify-between">
        <div className={clsx(
          "flex items-center gap-3 mb-1 transition-opacity duration-200",
          isCollapsed && "opacity-0 w-0 overflow-hidden"
        )}>
          <img src={logo} alt="Plexus" className="w-8 h-8" />
          <h1 className="font-heading text-xl font-bold m-0 bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary">Plexus</h1>
        </div>

        <button
          onClick={toggleSidebar}
          className="p-2 rounded-md hover:bg-bg-hover transition-colors duration-200 text-text-secondary hover:text-text flex-shrink-0"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      <p className={clsx(
        "text-xs text-text-muted mt-1 px-5 transition-opacity duration-200",
        isCollapsed && "opacity-0 h-0 overflow-hidden"
      )}>
        AI Infrastructure Management
      </p>

      <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
        <div className="px-2">
            <h3 className={clsx(
              "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2 transition-opacity duration-200",
              isCollapsed && "opacity-0 h-0 overflow-hidden"
            )}>Main</h3>
            <NavItem to="/" icon={LayoutDashboard} label="Dashboard" isCollapsed={isCollapsed} />
            <NavItem to="/usage" icon={Activity} label="Usage" isCollapsed={isCollapsed} />
            <NavItem to="/logs" icon={FileText} label="Logs" isCollapsed={isCollapsed} />
        </div>

        <div className="mt-6 px-2">
            <h3 className={clsx(
              "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2 transition-opacity duration-200",
              isCollapsed && "opacity-0 h-0 overflow-hidden"
            )}>Configuration</h3>
            <NavItem to="/providers" icon={Server} label="Providers" isCollapsed={isCollapsed} />
            <NavItem to="/models" icon={Box} label="Models" isCollapsed={isCollapsed} />
            <NavItem to="/keys" icon={Key} label="Keys" isCollapsed={isCollapsed} />
            <NavItem to="/config" icon={Settings} label="Settings" isCollapsed={isCollapsed} />
            <NavItem to="/system-logs" icon={FileText} label="System Logs" isCollapsed={isCollapsed} />
        </div>

        <div className="mt-6 px-2 mt-auto">
            <h3 className={clsx(
              "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2 transition-opacity duration-200",
              isCollapsed && "opacity-0 h-0 overflow-hidden"
            )}>System</h3>
            {(() => {
              const debugButton = (
                <button
                  onClick={handleToggleClick}
                  className={clsx(
                    "flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover w-full bg-transparent",
                    isCollapsed && "justify-center",
                    debugMode ? "text-danger border-danger/30 shadow-sm bg-[rgba(239,68,68,0.1)] shadow-[0_2px_8px_rgba(239,68,68,0.15)] hover:bg-[rgba(239,68,68,0.15)]" : "text-text-secondary hover:text-text"
                  )}
                  style={{ marginBottom: '8px' }}
                >
                  <Bug size={20} />
                  <span className={clsx(
                    "transition-opacity duration-200",
                    isCollapsed && "opacity-0 w-0 overflow-hidden"
                  )}>
                    {debugMode ? 'Debug Mode: On' : 'Debug Mode: Off'}
                  </span>
                </button>
              );

              return isCollapsed ? (
                <Tooltip content={debugMode ? "Debug Mode: On" : "Debug Mode: Off"} position="right">
                  {debugButton}
                </Tooltip>
              ) : debugButton;
            })()}
            <NavItem to="/debug" icon={Database} label="Debug Traces" isCollapsed={isCollapsed} />
            <NavItem to="/errors" icon={AlertTriangle} label="Errors" isCollapsed={isCollapsed} />
            {(() => {
              const logoutButton = (
                <button
                  onClick={handleLogout}
                  className={clsx(
                    "flex items-center gap-3 py-3 px-2 rounded-md font-body text-sm font-medium text-danger no-underline cursor-pointer transition-all duration-200 border border-transparent w-full bg-transparent border-transparent hover:text-danger hover:border-danger/30 hover:bg-red-500/10 mt-4",
                    isCollapsed && "justify-center"
                  )}
                >
                  <LogOut size={20} />
                  <span className={clsx(
                    "transition-opacity duration-200",
                    isCollapsed && "opacity-0 w-0 overflow-hidden"
                  )}>
                    Logout
                  </span>
                </button>
              );

              return isCollapsed ? (
                <Tooltip content="Logout" position="right">
                  {logoutButton}
                </Tooltip>
              ) : logoutButton;
            })()}
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
