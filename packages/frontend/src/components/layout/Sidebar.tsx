import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Server,
  Boxes,
  ScrollText,
  Route,
  Terminal,
  LogOut,
  AlertTriangle,
  Key,
  PanelLeftClose,
  PanelLeftOpen,
  Gauge,
  PlugZap,
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
import { PlexusMark } from './PlexusMark';

interface SidebarProps {
  mode?: 'desktop' | 'drawer';
}

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  collapsed: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, collapsed }) => {
  const navLink = (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'group relative flex items-center gap-2.5 py-2 px-2.5 rounded-md font-body text-[13px] font-medium no-underline cursor-pointer transition-all duration-fast',
          'text-text-secondary hover:bg-bg-hover hover:text-text',
          collapsed && 'justify-center',
          // Active state: amber tint + a left rail via :before pseudo-element
          // (cleaner than a sibling <span> and avoids NavLink render-prop quirks).
          isActive &&
            !collapsed &&
            'bg-amber-500/10 text-amber-300 before:content-[""] before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-sm before:bg-gradient-to-b before:from-secondary before:to-primary',
          isActive && collapsed && 'bg-amber-500/10 text-amber-300'
        )
      }
    >
      <Icon size={16} className="flex-shrink-0" />
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

const NavSection: React.FC<{ title: string; collapsed: boolean }> = ({ title, collapsed }) => (
  <div
    className={clsx(
      'px-2.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted font-medium transition-opacity duration-fast',
      collapsed && 'opacity-0 h-0 overflow-hidden pt-0 pb-0'
    )}
  >
    {title}
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({ mode = 'desktop' }) => {
  const appVersion: string =
    // @ts-expect-error — replaced at build time by build.ts
    process.env.APP_VERSION || 'dev';
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const { logout, isAdmin, isLimited, principal } = useAuth();
  const { isCollapsed, toggleSidebar, isMobileOpen, closeMobile } = useSidebar();
  const location = useLocation();

  const collapsed = mode === 'desktop' && isCollapsed;

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

  const parseVersionTag = (tag: string): [number, number, number, number] | null => {
    const calverMatch = tag.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/);
    if (calverMatch) {
      return [
        parseInt(calverMatch[1]!, 10),
        parseInt(calverMatch[2]!, 10),
        parseInt(calverMatch[3]!, 10),
        parseInt(calverMatch[4]!, 10),
      ];
    }
    const semverMatch = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (semverMatch) {
      return [0, 0, 0, parseInt(semverMatch[1] + semverMatch[2] + semverMatch[3]!, 10)];
    }
    return null;
  };

  const compareVersionTags = (a: string, b: string): number => {
    const parsedA = parseVersionTag(a);
    const parsedB = parseVersionTag(b);
    if (!parsedA || !parsedB) return 0;
    for (let i = 0; i < 4; i++) {
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
        if (latestRelease.tag_name && parseVersionTag(latestRelease.tag_name)) {
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
    latestVersion &&
      parseVersionTag(appVersion) &&
      compareVersionTags(appVersion, latestVersion) < 0
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

  const balanceQuotas = quotas.filter((q) => q.meters.some((m) => m.kind === 'balance'));
  const allowanceQuotas = quotas.filter((q) => q.meters.some((m) => m.kind === 'allowance'));

  const isDrawer = mode === 'drawer';
  const initials =
    principal?.role === 'admin' ? 'AD' : (principal?.keyName || 'KU').slice(0, 2).toUpperCase();

  return (
    <aside
      data-collapsed={collapsed}
      className={clsx(
        // Solid background — glass-bg used to let the page content scroll
        // through visibly. Sidebar must fully obscure what's underneath.
        'bg-bg-card border-border flex flex-col overflow-y-auto overflow-x-hidden',
        isDrawer
          ? 'h-full w-full'
          : 'hidden md:flex fixed left-0 top-0 h-screen z-[200] border-r transition-[width] duration-300',
        !isDrawer && (collapsed ? 'w-[64px]' : 'w-[220px]')
      )}
    >
      {/* Brand header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
        <div
          className={clsx(
            'flex items-center gap-2.5 min-w-0 transition-opacity duration-fast',
            collapsed && 'opacity-0 w-0 overflow-hidden'
          )}
        >
          <PlexusMark size={28} />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[1.05rem] font-semibold amber-grad-text font-heading tracking-tight truncate">
              Plexus
            </span>
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-text-muted font-mono leading-none">
              <span>{appVersion}</span>
              {isOutdated && (
                <Tooltip content={`Update available: ${latestVersion}`} position="bottom">
                  <span
                    className="inline-flex text-primary"
                    aria-label={`Outdated version. Latest is ${latestVersion}`}
                  >
                    <AlertTriangle size={10} />
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
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
        {isDrawer && (
          <button
            onClick={closeMobile}
            className="p-1.5 rounded-md hover:bg-bg-hover transition-colors duration-fast text-text-secondary hover:text-text flex-shrink-0"
            aria-label="Close navigation"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 pb-2 flex flex-col gap-0.5">
        <NavSection title="Main" collapsed={collapsed} />
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
        <NavItem to="/logs" icon={ScrollText} label="Logs" collapsed={collapsed} />
        <NavItem to="/errors" icon={AlertTriangle} label="Errors" collapsed={collapsed} />
        {isLimited && <NavItem to="/me" icon={UserCircle2} label="My Key" collapsed={collapsed} />}

        {/* Balances widget */}
        {isAdmin && balanceQuotas.length > 0 && !collapsed && (
          <div className="mt-3 px-2.5 py-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Balances
              </span>
            </div>
            <CompactBalancesCard balanceQuotas={balanceQuotas} />
          </div>
        )}

        {/* Quotas widget */}
        {isAdmin && allowanceQuotas.length > 0 && !collapsed && (
          <div className="mt-2 px-2.5 py-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Quotas
              </span>
            </div>
            <CompactQuotasCard allowanceQuotas={allowanceQuotas} />
          </div>
        )}

        {isAdmin && (
          <>
            <NavSection title="Configuration" collapsed={collapsed} />
            <NavItem to="/providers" icon={Server} label="Providers" collapsed={collapsed} />
            <NavItem to="/models" icon={Boxes} label="Models" collapsed={collapsed} />
            <NavItem to="/keys" icon={Key} label="Keys" collapsed={collapsed} />
            <NavItem to="/quotas" icon={Gauge} label="Quotas" collapsed={collapsed} />
            <NavItem to="/mcp" icon={PlugZap} label="MCP" collapsed={collapsed} />
            <NavItem to="/config" icon={Settings} label="Settings" collapsed={collapsed} />
          </>
        )}

        <NavSection title="Dev Tools" collapsed={collapsed} />
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <NavItem to="/debug" icon={Route} label="Traces" collapsed={collapsed} />
          </div>
          {isAdmin && !collapsed && (
            <button
              onClick={handleToggleClick}
              className={clsx(
                'mr-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all duration-fast flex-shrink-0 font-mono',
                debugMode
                  ? 'bg-danger text-white hover:bg-red-700'
                  : 'bg-slate-700/40 text-text-muted hover:bg-slate-700/60'
              )}
            >
              {debugMode ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
        {isAdmin && (
          <NavItem to="/system-logs" icon={Terminal} label="System Logs" collapsed={collapsed} />
        )}
      </nav>

      {/* User pill + logout */}
      <div className="p-3 border-t border-slate-800/80 mt-auto space-y-2">
        {principal && !collapsed && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="w-7 h-7 rounded-full amber-grad-bg grid place-items-center text-[11px] font-semibold text-amber-950 flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-text truncate">
                {principal.role === 'admin' ? 'Admin' : principal.keyName}
              </div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider font-mono">
                {principal.role === 'admin' ? 'full access' : 'limited'}
              </div>
            </div>
            <Tooltip content="Sign out" position="top">
              <button
                onClick={handleLogout}
                className="p-1 rounded text-text-secondary hover:text-danger hover:bg-red-500/10 transition-colors"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </Tooltip>
          </div>
        )}
        {collapsed && (
          <Tooltip content="Sign out" position="right">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center py-2 rounded-md text-danger hover:bg-red-500/10 transition-colors"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={debugMode ? 'Disable Debug Mode?' : 'Enable Debug Mode?'}
        size="sm"
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
        <p className="text-sm text-text-secondary">
          {debugMode
            ? 'Disabling debug mode will stop capturing full request/response payloads.'
            : 'Enabling debug mode will capture FULL raw request and response payloads, including personal data if present. This can consume significant storage.'}
        </p>
      </Modal>
    </aside>
  );
};
