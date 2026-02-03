import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, Settings, Server, Box, FileText, Database, LogOut, AlertTriangle, Key, PanelLeftClose, PanelLeftOpen, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { SyntheticQuotaDisplay, ClaudeCodeQuotaDisplay, NagaQuotaDisplay } from '../quota';
import type { QuotaCheckerInfo, QuotaCheckResult } from '../../types/quota';
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
        'flex items-center gap-3 py-1.5 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover hover:text-text',
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
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const [mainExpanded, setMainExpanded] = useState(true);
  const [quotasExpanded, setQuotasExpanded] = useState(true);
  const [configExpanded, setConfigExpanded] = useState(true);
  const [devToolsExpanded, setDevToolsExpanded] = useState(false);
  const { logout } = useAuth();
  const { isCollapsed, toggleSidebar } = useSidebar();

  useEffect(() => {
    api.getDebugMode().then(setDebugMode);
  }, []);

  useEffect(() => {
    const fetchQuotas = async () => {
      console.log('[Sidebar] Fetching quotas...');
      const data = await api.getQuotas();
      console.log('[Sidebar] Quotas data:', data);
      setQuotas(data);
    };
    fetchQuotas();
    // Refresh quotas every 30 seconds
    const interval = setInterval(fetchQuotas, 30000);
    return () => clearInterval(interval);
  }, []);

  // Convert QuotaSnapshot[] to QuotaCheckResult format for display
  const getQuotaResult = (checkerId: string): QuotaCheckResult | undefined => {
    const checker = quotas.find(q => q.checkerId === checkerId);
    if (!checker || !checker.latest || checker.latest.length === 0) return undefined;
    
    // Get unique window types (in case of duplicates, take the most recent)
    const windowsByType = new Map<string, typeof checker.latest[0]>();
    for (const snapshot of checker.latest) {
      const existing = windowsByType.get(snapshot.windowType);
      if (!existing || snapshot.checkedAt > existing.checkedAt) {
        windowsByType.set(snapshot.windowType, snapshot);
      }
    }
    
    const windows = Array.from(windowsByType.values()).map(snapshot => ({
      windowType: snapshot.windowType as any,
      windowLabel: snapshot.description || snapshot.windowType,
      limit: snapshot.limit || undefined,
      used: snapshot.used || undefined,
      remaining: snapshot.remaining || undefined,
      utilizationPercent: snapshot.utilizationPercent || 0,
      unit: (snapshot.unit as any) || 'percentage',
      resetsAt: snapshot.resetsAt ? new Date(snapshot.resetsAt).toISOString() : undefined,
      status: (snapshot.status as any) || 'ok',
    }));
    
    const firstSnapshot = checker.latest[0];
    return {
      provider: firstSnapshot.provider,
      checkerId: firstSnapshot.checkerId,
      checkedAt: new Date(firstSnapshot.checkedAt).toISOString(),
      success: firstSnapshot.success === 1,
      windows,
    };
  };

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
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className={clsx(
          "flex items-center gap-2 transition-opacity duration-200",
          isCollapsed && "opacity-0 w-0 overflow-hidden"
        )}>
          <img src={logo} alt="Plexus" className="w-6 h-6" />
          <h1 className="font-heading text-lg font-bold m-0 bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary">Plexus</h1>
        </div>

        <button
          onClick={toggleSidebar}
          className="p-2 rounded-md hover:bg-bg-hover transition-colors duration-200 text-text-secondary hover:text-text flex-shrink-0"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      <nav className="flex-1 py-2 px-2 flex flex-col gap-1">
        <div className="px-2">
            <button
              onClick={() => setMainExpanded(!mainExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3 className={clsx(
                "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>Main</h3>
              {!isCollapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    "text-text-muted transition-transform duration-200 group-hover:text-text",
                    mainExpanded && "rotate-90"
                  )}
                />
              )}
            </button>
            {(mainExpanded || isCollapsed) && (
              <>
                <NavItem to="/" icon={LayoutDashboard} label="Dashboard" isCollapsed={isCollapsed} />
                <NavItem to="/usage" icon={Activity} label="Usage" isCollapsed={isCollapsed} />
                <NavItem to="/logs" icon={FileText} label="Logs" isCollapsed={isCollapsed} />
              </>
            )}
        </div>

        {/* Quotas Section */}
        <div className="mt-4 px-2">
            <button
              onClick={() => setQuotasExpanded(!quotasExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3 className={clsx(
                "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>Quotas</h3>
              {!isCollapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    "text-text-muted transition-transform duration-200 group-hover:text-text",
                    quotasExpanded && "rotate-90"
                  )}
                />
              )}
            </button>
            {(quotasExpanded || isCollapsed) && (
              <>
                {quotas.length === 0 ? (
                  !isCollapsed && (
                    <p className="text-xs text-text-muted px-2">No quota checkers configured</p>
                  )
                ) : (
                  <div className="space-y-1">
                    {quotas.map((quota) => {
                      const result = getQuotaResult(quota.checkerId);
                      if (!result) {
                        console.warn(`No result for quota checker: ${quota.checkerId}`);
                        return null;
                      }
                      
                      // Use Synthetic display for synthetic checkers
                      if (quota.checkerId.includes('synthetic')) {
                        return (
                          <SyntheticQuotaDisplay
                            key={quota.checkerId}
                            result={result}
                            isCollapsed={isCollapsed}
                          />
                        );
                      }
                      
                      // Use Claude Code display for claude checkers
                      if (quota.checkerId.includes('claude')) {
                        return (
                          <ClaudeCodeQuotaDisplay
                            key={quota.checkerId}
                            result={result}
                            isCollapsed={isCollapsed}
                          />
                        );
                      }

                      // Use Naga display for naga checkers
                      if (quota.checkerId.includes('naga')) {
                        return (
                          <NagaQuotaDisplay
                            key={quota.checkerId}
                            result={result}
                            isCollapsed={isCollapsed}
                          />
                        );
                      }

                      // Fallback: show checker ID for unknown types
                      console.warn(`Unknown quota checker type: ${quota.checkerId}`);
                      return null;
                    })}
                  </div>
                )}
              </>
            )}
        </div>

        <div className="mt-4 px-2">
            <button
              onClick={() => setConfigExpanded(!configExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3 className={clsx(
                "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>Configuration</h3>
              {!isCollapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    "text-text-muted transition-transform duration-200 group-hover:text-text",
                    configExpanded && "rotate-90"
                  )}
                />
              )}
            </button>
            {(configExpanded || isCollapsed) && (
              <>
                <NavItem to="/providers" icon={Server} label="Providers" isCollapsed={isCollapsed} />
                <NavItem to="/models" icon={Box} label="Models" isCollapsed={isCollapsed} />
                <NavItem to="/keys" icon={Key} label="Keys" isCollapsed={isCollapsed} />
                <NavItem to="/config" icon={Settings} label="Settings" isCollapsed={isCollapsed} />
              </>
            )}
        </div>

        <div className="mt-4 px-2 mt-auto">
            <button
              onClick={() => setDevToolsExpanded(!devToolsExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3 className={clsx(
                "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>Dev Tools</h3>
              {!isCollapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    "text-text-muted transition-transform duration-200 group-hover:text-text",
                    devToolsExpanded && "rotate-90"
                  )}
                />
              )}
            </button>
            {(devToolsExpanded || isCollapsed) && (
              <>
                <div className="flex items-center justify-between">
                  <NavItem to="/debug" icon={Database} label="Traces" isCollapsed={isCollapsed} />
                  {!isCollapsed && (
                    <button
                      onClick={handleToggleClick}
                      className={clsx(
                        "ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all duration-200 flex-shrink-0",
                        debugMode 
                          ? "bg-danger text-white hover:bg-danger/80" 
                          : "bg-text-muted/20 text-text-muted hover:bg-text-muted/30"
                      )}
                    >
                      {debugMode ? 'ON' : 'OFF'}
                    </button>
                  )}
                </div>
                <NavItem to="/errors" icon={AlertTriangle} label="Errors" isCollapsed={isCollapsed} />
                <NavItem to="/system-logs" icon={FileText} label="System Logs" isCollapsed={isCollapsed} />
              </>
            )}
            {(() => {
              const logoutButton = (
                <button
                  onClick={handleLogout}
                  className={clsx(
                    "flex items-center gap-3 py-2 px-2 rounded-md font-body text-sm font-medium text-danger no-underline cursor-pointer transition-all duration-200 border border-transparent w-full bg-transparent border-transparent hover:text-danger hover:border-danger/30 hover:bg-red-500/10 mt-3",
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
