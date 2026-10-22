import { clsx } from 'clsx';
import {
  AlertTriangle,
  Boxes,
  FlaskConical,
  Gauge,
  Key,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Route,
  ScrollText,
  Server,
  Settings,
  Terminal,
  UserCircle2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { api, fetchQuotaCheckers } from '../../lib/api';
import type { QuotaCheckerInfo } from '../../types/quota';
import { CompactBalancesCard, CompactQuotasCard } from '../quota';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';
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
          'group font-body duration-fast relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium no-underline transition-all',
          'text-text-secondary hover:bg-bg-hover hover:text-text',
          collapsed && 'justify-center',
          // Active state: amber tint + a left rail via :before pseudo-element
          // (cleaner than a sibling <span> and avoids NavLink render-prop quirks).
          isActive &&
            !collapsed &&
            'before:from-secondary before:to-primary bg-amber-500/10 text-amber-300 before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-0.5 before:rounded-sm before:bg-gradient-to-b before:content-[""]',
          isActive && collapsed && 'bg-amber-500/10 text-amber-300'
        )
      }
    >
      <Icon size={16} className="flex-shrink-0" />
      <span
        className={clsx(
          'duration-fast transition-opacity',
          collapsed && 'w-0 overflow-hidden opacity-0'
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
      'text-text-muted duration-fast px-2.5 pt-2 pb-1 font-mono text-[10px] font-medium tracking-[0.08em] uppercase transition-opacity',
      collapsed && 'h-0 overflow-hidden pt-0 pb-0 opacity-0'
    )}
  >
    {title}
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({ mode = 'desktop' }) => {
  const appVersion: string = process.env.APP_VERSION || 'dev';
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<(QuotaCheckerInfo & { pending?: boolean })[]>([]);
  const [displayNameMap, setDisplayNameMap] = useState<Map<string, string>>(new Map());
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
    const loadQuotas = async () => {
      const data = await fetchQuotaCheckers();
      setDisplayNameMap(new Map(data.knownTypes.map((t) => [t.type, t.displayName])));
      setQuotas(data.configured);
    };
    loadQuotas();
    const interval = setInterval(loadQuotas, 60000);
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
  // Failed checks carry no meters — keep them in the Quotas widget so the
  // panel shows the error state instead of disappearing entirely. Pending
  // checkers (no snapshot yet) stay hidden, as before.
  const allowanceQuotas = quotas.filter(
    (q) => (!q.success && !q.pending) || q.meters.some((m) => m.kind === 'allowance')
  );

  const isDrawer = mode === 'drawer';
  const initials =
    principal?.role === 'admin' ? 'AD' : (principal?.keyName || 'KU').slice(0, 2).toUpperCase();

  return (
    <aside
      data-collapsed={collapsed}
      className={clsx(
        // Solid background — glass-bg used to let the page content scroll
        // through visibly. Sidebar must fully obscure what's underneath.
        'bg-bg-card border-border flex flex-col overflow-x-hidden overflow-y-auto',
        isDrawer
          ? 'h-full w-full'
          : 'fixed top-0 left-0 z-[200] hidden h-screen border-r transition-[width] duration-300 md:flex',
        !isDrawer && (collapsed ? 'w-[64px]' : 'w-[220px]')
      )}
    >
      {/* Brand header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div
          className={clsx(
            'duration-fast flex min-w-0 items-center gap-2.5 transition-opacity',
            collapsed && 'w-0 overflow-hidden opacity-0'
          )}
        >
          <PlexusMark size={28} />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="amber-grad-text font-heading truncate text-[1.05rem] font-semibold tracking-tight">
              Plexus
            </span>
            <div className="text-text-muted flex items-center gap-1 font-mono text-[9px] leading-none tracking-[0.16em] uppercase">
              <span>{appVersion}</span>
              {isOutdated && (
                <Tooltip content={`Update available: ${latestVersion}`} position="bottom">
                  <span
                    className="text-primary inline-flex"
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
            className="hover:bg-bg-hover duration-fast text-text-secondary hover:text-text focus-visible:outline-primary flex-shrink-0 rounded-md p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
        {isDrawer && (
          <button
            onClick={closeMobile}
            className="hover:bg-bg-hover duration-fast text-text-secondary hover:text-text flex-shrink-0 rounded-md p-1.5 transition-colors"
            aria-label="Close navigation"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pb-2">
        <NavSection title="Main" collapsed={collapsed} />
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
        <NavItem to="/logs" icon={ScrollText} label="Logs" collapsed={collapsed} />
        <NavItem to="/errors" icon={AlertTriangle} label="Errors" collapsed={collapsed} />
        {isLimited && <NavItem to="/me" icon={UserCircle2} label="My Key" collapsed={collapsed} />}

        {/* Balances widget */}
        {isAdmin && balanceQuotas.length > 0 && !collapsed && (
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-text-muted text-[10px] font-medium tracking-wider uppercase">
                Balances
              </span>
            </div>
            <CompactBalancesCard balanceQuotas={balanceQuotas} displayNameMap={displayNameMap} />
          </div>
        )}

        {/* Quotas widget */}
        {isAdmin && allowanceQuotas.length > 0 && !collapsed && (
          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-text-muted text-[10px] font-medium tracking-wider uppercase">
                Quotas
              </span>
            </div>
            <CompactQuotasCard allowanceQuotas={allowanceQuotas} displayNameMap={displayNameMap} />
          </div>
        )}

        {isAdmin && (
          <>
            <NavSection title="Configuration" collapsed={collapsed} />
            <NavItem to="/providers" icon={Server} label="Providers" collapsed={collapsed} />
            <NavItem to="/models" icon={Boxes} label="Models" collapsed={collapsed} />
            <NavItem to="/keys" icon={Key} label="Keys" collapsed={collapsed} />
            <NavItem to="/quotas" icon={Gauge} label="Quotas" collapsed={collapsed} />
            <NavItem to="/mcp" icon={PlugZap} label="MCP & Skills" collapsed={collapsed} />
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
                'duration-fast mr-1 flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-all',
                debugMode
                  ? 'bg-danger text-white hover:bg-red-700'
                  : 'text-text-muted bg-slate-700/40 hover:bg-slate-700/60'
              )}
            >
              {debugMode ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
        {isAdmin && (
          <NavItem to="/system-logs" icon={Terminal} label="System Logs" collapsed={collapsed} />
        )}
        {isAdmin && (
          <NavItem to="/playground" icon={FlaskConical} label="Playground" collapsed={collapsed} />
        )}
      </nav>

      {/* User pill + logout */}
      <div className="mt-auto space-y-2 border-t border-slate-800/80 p-3">
        {principal && !collapsed && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5">
            <div className="amber-grad-bg grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[11px] font-semibold text-amber-950">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-text truncate text-xs font-medium">
                {principal.role === 'admin' ? 'Admin' : principal.keyName}
              </div>
              <div className="text-text-muted font-mono text-[10px] tracking-wider uppercase">
                {principal.role === 'admin' ? 'full access' : 'limited'}
              </div>
            </div>
            <Tooltip content="Sign out" position="top">
              <button
                onClick={handleLogout}
                className="text-text-secondary hover:text-danger rounded p-1 transition-colors hover:bg-red-500/10"
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
              className="text-danger flex w-full items-center justify-center rounded-md py-2 transition-colors hover:bg-red-500/10"
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
        <p className="text-text-secondary text-sm">
          {debugMode
            ? 'Disabling debug mode will stop capturing full request/response payloads.'
            : 'Enabling debug mode will capture FULL raw request and response payloads, including personal data if present. This can consume significant storage.'}
        </p>
      </Modal>
    </aside>
  );
};
