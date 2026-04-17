import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Server,
  Box,
  FileText,
  Database,
  LogOut,
  AlertTriangle,
  Key,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  PieChart,
  Plug,
  UserCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { CompactBalancesCard, CompactQuotasCard } from '../quota';
import type { QuotaCheckerInfo } from '../../types/quota';
import { toBoolean, toIsoString } from '../../lib/normalize';

import logo from '../../assets/plexus_logo_transparent.png';

interface SidebarProps {
  /** desktop = fixed aside with collapse rail; drawer = flush content rendered inside a Drawer. */
  mode?: 'desktop' | 'drawer';
}

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ size: number }>;
  label: string;
  collapsed: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, collapsed }) => {
  const navLink = (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 py-1.5 px-2 rounded-md font-body text-sm font-medium text-text-secondary no-underline cursor-pointer transition-all duration-fast border border-transparent hover:bg-bg-hover hover:text-text',
          collapsed && 'justify-center',
          isActive &&
            'bg-bg-glass text-primary border-border-glass backdrop-blur-md shadow-nav-active'
        )
      }
    >
      <Icon size={20} />
      <span
        className={clsx(
          'transition-opacity duration-fast',
          collapsed && 'opacity-0 w-0 overflow-hidden'
        )}
      >
        {label}
      </span>
    </NavLink>
  );

  return collapsed ? (
    <Tooltip content={label} position="right">
      {navLink}
    </Tooltip>
  ) : (
    navLink
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ mode = 'desktop' }) => {
  // biome-ignore lint/security/noGlobalAssign: build-time constant injected by bundler
  const appVersion: string =
    // @ts-expect-error — replaced at build time by build.ts
    process.env.APP_VERSION || 'dev';
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [mainExpanded, setMainExpanded] = useState(true);
  const [balancesExpanded, setBalancesExpanded] = useState(true);
  const [quotasExpanded, setQuotasExpanded] = useState(true);
  const [configExpanded, setConfigExpanded] = useState(true);
  const [devToolsExpanded, setDevToolsExpanded] = useState(false);
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const { logout, isAdmin, isLimited, principal } = useAuth();
  const { isCollapsed, toggleSidebar, isMobileOpen, closeMobile } = useSidebar();
  const location = useLocation();

  // Drawer mode always renders expanded; desktop respects user preference.
  const collapsed = mode === 'desktop' && isCollapsed;

  // Auto-close drawer on navigation. Only fires on pathname *changes*, not on
  // initial mount — otherwise opening the drawer would immediately close it,
  // since the drawer-mode Sidebar mounts with location.pathname already set.
  const lastPathnameRef = useRef(location.pathname);
  useEffect(() => {
    const pathChanged = lastPathnameRef.current !== location.pathname;
    lastPathnameRef.current = location.pathname;
    if (pathChanged && mode === 'drawer' && isMobileOpen) {
      closeMobile();
    }
  }, [location.pathname, mode, isMobileOpen, closeMobile]);

  useEffect(() => {
    api.getDebugMode().then((result) => setDebugMode(result.enabled));
  }, []);

  useEffect(() => {
    const fetchQuotas = async () => {
      const data = await api.getQuotas();
      setQuotas(data);
    };
    fetchQuotas();
    const interval = setInterval(fetchQuotas, 60000);
    return () => clearInterval(interval);
  }, []);

  const parseSemverTag = (tag: string): [number, number, number] | null => {
    const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return [parseInt(match[1]!, 10), parseInt(match[2]!, 10), parseInt(match[3]!, 10)];
  };

  const compareSemverTags = (a: string, b: string): number => {
    const parsedA = parseSemverTag(a);
    const parsedB = parseSemverTag(b);
    if (!parsedA || !parsedB) return 0;
    for (let i = 0; i < 3; i++) {
      if (parsedA[i]! !== parsedB[i]!) {
        return parsedA[i]! - parsedB[i]!;
      }
    }
    return 0;
  };

  useEffect(() => {
    const controller = new AbortController();
    const fetchLatestVersion = async () => {
      try {
        const response = await fetch(
          'https://api.github.com/repos/mcowger/plexus/releases/latest',
          {
            signal: controller.signal,
            headers: { Accept: 'application/vnd.github+json' },
          }
        );
        if (!response.ok) return;
        const latestRelease = (await response.json()) as { tag_name?: string };
        if (latestRelease.tag_name && parseSemverTag(latestRelease.tag_name)) {
          setLatestVersion(latestRelease.tag_name);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.warn('Failed to fetch latest Plex release tag', error);
        }
      }
    };
    fetchLatestVersion();
    return () => controller.abort();
  }, []);

  const isOutdated = Boolean(
    latestVersion && parseSemverTag(appVersion) && compareSemverTags(appVersion, latestVersion) < 0
  );

  const handleToggleClick = () => setShowConfirm(true);

  const confirmToggle = async () => {
    try {
      const newState = await api.setDebugMode(!debugMode);
      setDebugMode(newState.enabled);
    } catch (e) {
      console.error('Failed to toggle debug mode', e);
    } finally {
      setShowConfirm(false);
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/ui/login';
  };

  const getQuotaResult = (quota: QuotaCheckerInfo) => {
    if (!quota.latest || quota.latest.length === 0) {
      return {
        provider: 'unknown',
        checkerId: quota.checkerId,
        oauthAccountId: quota.oauthAccountId,
        oauthProvider: quota.oauthProvider,
        checkedAt: new Date().toISOString(),
        success: false,
        error: 'No quota data available yet',
        windows: [],
      };
    }
    const windowsByType = new Map<string, (typeof quota.latest)[0]>();
    for (const snapshot of quota.latest) {
      const key = snapshot.description
        ? `${snapshot.windowType}:${snapshot.description}`
        : snapshot.windowType;
      const existing = windowsByType.get(key);
      if (!existing || snapshot.checkedAt > existing.checkedAt) {
        windowsByType.set(key, snapshot);
      }
    }
    const windows = Array.from(windowsByType.values()).map((snapshot) => ({
      windowType: snapshot.windowType as any,
      windowLabel: snapshot.description || snapshot.windowType,
      limit: snapshot.limit ?? undefined,
      used: snapshot.used ?? undefined,
      remaining: snapshot.remaining ?? undefined,
      utilizationPercent: snapshot.utilizationPercent ?? 0,
      unit: (snapshot.unit as any) || 'percentage',
      resetsAt: toIsoString(snapshot.resetsAt) ?? undefined,
      resetInSeconds:
        snapshot.resetInSeconds !== null && snapshot.resetInSeconds !== undefined
          ? snapshot.resetInSeconds
          : undefined,
      status: (snapshot.status as any) || 'ok',
    }));
    const firstSnapshot = quota.latest[0];
    const errorFromSnapshots =
      quota.latest.find((snapshot) => snapshot.errorMessage)?.errorMessage || undefined;
    return {
      provider: firstSnapshot.provider,
      checkerId: firstSnapshot.checkerId,
      oauthAccountId: quota.oauthAccountId,
      oauthProvider: quota.oauthProvider,
      checkedAt: toIsoString(firstSnapshot.checkedAt) ?? new Date(0).toISOString(),
      success: toBoolean(firstSnapshot.success),
      error: errorFromSnapshots,
      windows,
    };
  };

  const BALANCE_CHECKERS_WITH_RATE_LIMIT = new Set(['neuralwatt']);
  const balanceQuotas = quotas.filter((quota) => quota.checkerCategory === 'balance');
  const rateLimitQuotas = quotas.filter(
    (quota) =>
      quota.checkerCategory === 'rate-limit' ||
      BALANCE_CHECKERS_WITH_RATE_LIMIT.has(quota.checkerType || quota.checkerId)
  );

  const isDrawer = mode === 'drawer';

  return (
    <aside
      data-collapsed={collapsed}
      className={clsx(
        'bg-bg-surface flex flex-col overflow-y-auto overflow-x-hidden border-r border-border',
        isDrawer
          ? 'h-full w-full border-r-0'
          : 'hidden md:flex fixed left-0 top-0 h-screen z-sidebar transition-[width] duration-300',
        !isDrawer && (collapsed ? 'w-[64px]' : 'w-[200px]')
      )}
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div
          className={clsx(
            'flex items-center gap-2 min-w-0 transition-opacity duration-fast',
            collapsed && 'opacity-0 w-0 overflow-hidden'
          )}
        >
          <img src={logo} alt="" className="w-6 h-6 flex-shrink-0" />
          <div className="flex flex-col min-w-0">
            <h1 className="font-heading text-lg font-bold m-0 bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary truncate">
              Plexus
            </h1>
            <div className="flex items-center gap-1 text-[10px] leading-none text-text-muted">
              <span>{appVersion}</span>
              {isOutdated && (
                <Tooltip content={`Update available: ${latestVersion}`} position="bottom">
                  <span
                    className="inline-flex text-primary"
                    aria-label={`Outdated version. Latest is ${latestVersion}`}
                  >
                    <AlertTriangle size={11} />
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        {!isDrawer && (
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md hover:bg-bg-hover transition-colors duration-fast text-text-secondary hover:text-text flex-shrink-0 focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
        {isDrawer && (
          <button
            onClick={closeMobile}
            className="p-1.5 rounded-md hover:bg-bg-hover transition-colors duration-fast text-text-secondary hover:text-text flex-shrink-0 focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
            aria-label="Close navigation"
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 flex flex-col gap-1">
        <div className="px-2">
          <button
            onClick={() => setMainExpanded(!mainExpanded)}
            className="w-full flex items-center justify-between mb-1 group"
          >
            <h3
              className={clsx(
                'font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-fast',
                collapsed && 'opacity-0 h-0 overflow-hidden'
              )}
            >
              Main
            </h3>
            {!collapsed && (
              <ChevronRight
                size={14}
                className={clsx(
                  'text-text-muted transition-transform duration-fast group-hover:text-text',
                  mainExpanded && 'rotate-90'
                )}
              />
            )}
          </button>
          {(mainExpanded || collapsed) && (
            <>
              <NavItem to="/" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
              <NavItem to="/logs" icon={FileText} label="Logs" collapsed={collapsed} />
              {isAdmin && (
                <NavItem to="/quotas" icon={PieChart} label="Quotas" collapsed={collapsed} />
              )}
              {isLimited && (
                <NavItem to="/me" icon={UserCircle2} label="My Key" collapsed={collapsed} />
              )}
            </>
          )}
        </div>

        {isAdmin && balanceQuotas.length > 0 && (
          <div className="mt-4 px-2">
            <button
              onClick={() => setBalancesExpanded(!balancesExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3
                className={clsx(
                  'font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-fast',
                  collapsed && 'opacity-0 h-0 overflow-hidden'
                )}
              >
                Balances
              </h3>
              {!collapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    'text-text-muted transition-transform duration-fast group-hover:text-text',
                    balancesExpanded && 'rotate-90'
                  )}
                />
              )}
            </button>
            {(balancesExpanded || collapsed) && (
              <div
                className={clsx(
                  'rounded-md bg-bg-card border border-border overflow-hidden transition-opacity duration-fast',
                  collapsed && 'opacity-0 h-0 overflow-hidden'
                )}
              >
                <CompactBalancesCard
                  balanceQuotas={balanceQuotas}
                  getQuotaResult={getQuotaResult}
                />
              </div>
            )}
          </div>
        )}

        {isAdmin && rateLimitQuotas.length > 0 && (
          <div className="mt-4 px-2">
            <button
              onClick={() => setQuotasExpanded(!quotasExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3
                className={clsx(
                  'font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-fast',
                  collapsed && 'opacity-0 h-0 overflow-hidden'
                )}
              >
                Quotas
              </h3>
              {!collapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    'text-text-muted transition-transform duration-fast group-hover:text-text',
                    quotasExpanded && 'rotate-90'
                  )}
                />
              )}
            </button>
            {(quotasExpanded || collapsed) && (
              <div
                className={clsx(
                  'rounded-md bg-bg-card border border-border overflow-hidden transition-opacity duration-fast',
                  collapsed && 'opacity-0 h-0 overflow-hidden'
                )}
              >
                <CompactQuotasCard
                  rateLimitQuotas={rateLimitQuotas}
                  getQuotaResult={getQuotaResult}
                />
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 px-2">
            <button
              onClick={() => setConfigExpanded(!configExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3
                className={clsx(
                  'font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-fast',
                  collapsed && 'opacity-0 h-0 overflow-hidden'
                )}
              >
                Configuration
              </h3>
              {!collapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    'text-text-muted transition-transform duration-fast group-hover:text-text',
                    configExpanded && 'rotate-90'
                  )}
                />
              )}
            </button>
            {(configExpanded || collapsed) && (
              <>
                <NavItem to="/providers" icon={Server} label="Providers" collapsed={collapsed} />
                <NavItem to="/models" icon={Box} label="Models" collapsed={collapsed} />
                <NavItem to="/keys" icon={Key} label="Keys" collapsed={collapsed} />
                <NavItem to="/mcp" icon={Plug} label="MCP" collapsed={collapsed} />
                <NavItem to="/config" icon={Settings} label="Settings" collapsed={collapsed} />
              </>
            )}
          </div>
        )}

        <div className="mt-4 px-2 mt-auto">
          <button
            onClick={() => setDevToolsExpanded(!devToolsExpanded)}
            className="w-full flex items-center justify-between mb-1 group"
          >
            <h3
              className={clsx(
                'font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-fast',
                collapsed && 'opacity-0 h-0 overflow-hidden'
              )}
            >
              Dev Tools
            </h3>
            {!collapsed && (
              <ChevronRight
                size={14}
                className={clsx(
                  'text-text-muted transition-transform duration-fast group-hover:text-text',
                  devToolsExpanded && 'rotate-90'
                )}
              />
            )}
          </button>
          {(devToolsExpanded || collapsed) && (
            <>
              <div className="flex items-center justify-between">
                <NavItem to="/debug" icon={Database} label="Traces" collapsed={collapsed} />
                {isAdmin && !collapsed && (
                  <button
                    onClick={handleToggleClick}
                    className={clsx(
                      'ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all duration-fast flex-shrink-0',
                      debugMode
                        ? 'bg-danger text-white hover:bg-danger/80'
                        : 'bg-text-muted/20 text-text-muted hover:bg-text-muted/30'
                    )}
                  >
                    {debugMode ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
              <NavItem to="/errors" icon={AlertTriangle} label="Errors" collapsed={collapsed} />
              {isAdmin && (
                <NavItem
                  to="/system-logs"
                  icon={FileText}
                  label="System Logs"
                  collapsed={collapsed}
                />
              )}
            </>
          )}
          {principal && !collapsed && (
            <div className="mt-3 mx-1 px-2 py-1.5 rounded-md bg-bg-card border border-border flex items-center gap-2">
              <UserCircle2 size={16} className="text-text-muted flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-text truncate">
                  {principal.role === 'admin' ? 'Admin' : principal.keyName}
                </div>
                <div
                  className={clsx(
                    'text-[10px] uppercase tracking-wider font-semibold',
                    principal.role === 'admin' ? 'text-primary' : 'text-text-muted'
                  )}
                >
                  {principal.role === 'admin' ? 'Full access' : 'Limited'}
                </div>
              </div>
            </div>
          )}
          {(() => {
            const logoutButton = (
              <button
                onClick={handleLogout}
                className={clsx(
                  'flex items-center gap-3 py-2 px-2 rounded-md font-body text-sm font-medium text-danger cursor-pointer transition-all duration-fast border border-transparent w-full bg-transparent hover:text-danger hover:border-danger/30 hover:bg-red-500/10 mt-3',
                  collapsed && 'justify-center'
                )}
              >
                <LogOut size={20} />
                <span
                  className={clsx(
                    'transition-opacity duration-fast',
                    collapsed && 'opacity-0 w-0 overflow-hidden'
                  )}
                >
                  Logout
                </span>
              </button>
            );
            return collapsed ? (
              <Tooltip content="Logout" position="right">
                {logoutButton}
              </Tooltip>
            ) : (
              logoutButton
            );
          })()}
        </div>
      </nav>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={debugMode ? 'Disable Debug Mode?' : 'Enable Debug Mode?'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button variant={debugMode ? 'primary' : 'danger'} onClick={confirmToggle}>
              {debugMode ? 'Disable' : 'Enable'}
            </Button>
          </>
        }
      >
        <p>
          {debugMode
            ? 'Disabling debug mode will stop capturing full request/response payloads.'
            : 'Enabling debug mode will capture FULL raw request and response payloads, including personal data if present. This can consume significant storage.'}
        </p>
      </Modal>
    </aside>
  );
};
