import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, Gauge, Settings, Server, Box, FileText, Database, LogOut, AlertTriangle, Key, PanelLeftClose, PanelLeftOpen, ChevronRight, PieChart, Plug, Zap, BarChart3 } from 'lucide-react';
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
  const envAppVersion = process.env.APP_VERSION || 'dev';
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [buildVersion, setBuildVersion] = useState<string>(envAppVersion);
  const [buildVersionBase, setBuildVersionBase] = useState<string>(envAppVersion);
  const [buildMeta, setBuildMeta] = useState<string>('');

  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [mainExpanded, setMainExpanded] = useState(true);
  const [balancesExpanded, setBalancesExpanded] = useState(true);
  const [quotasExpanded, setQuotasExpanded] = useState(true);
  const [configExpanded, setConfigExpanded] = useState(true);
  const [devToolsExpanded, setDevToolsExpanded] = useState(false);
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const { logout } = useAuth();
  const { isCollapsed, toggleSidebar } = useSidebar();

  useEffect(() => {
    api.getDebugMode().then(setDebugMode);
  }, []);

  useEffect(() => {
    const loadBuildInfo = async () => {
      const info = await api.getBuildInfo();
      if (!info) {
        return;
      }

      setBuildVersion(info.displayVersion || info.version || envAppVersion);
      setBuildVersionBase(info.version || envAppVersion);
      const parsedBuildTime = info.buildTime ? new Date(info.buildTime) : null;
      const buildTimeLabel = parsedBuildTime && !Number.isNaN(parsedBuildTime.getTime())
        ? `Built: ${parsedBuildTime.toLocaleString()}`
        : (info.buildTime ? `Build Ref: ${info.buildTime}` : '');
      const metaParts = [
        buildTimeLabel,
        info.buildSha ? `SHA: ${info.buildSha}` : '',
      ].filter(Boolean);
      setBuildMeta(metaParts.join(' | '));
    };

    void loadBuildInfo();
  }, [envAppVersion]);

  // Fetch quotas
  useEffect(() => {
    const fetchQuotas = async () => {
      const data = await api.getQuotas();
      setQuotas(data);
    };
    fetchQuotas();
    // Refresh quotas every 60 seconds
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
        const response = await fetch('https://api.github.com/repos/mcowger/plexus/releases/latest', {
          signal: controller.signal,
          headers: {
            Accept: 'application/vnd.github+json',
          },
        });

        if (!response.ok) {
          return;
        }

        const latestRelease = await response.json() as { tag_name?: string };
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

    return () => {
      controller.abort();
    };
  }, []);

  const isOutdated = Boolean(
    latestVersion &&
    parseSemverTag(buildVersionBase) &&
    compareSemverTags(buildVersionBase, latestVersion) < 0
  );

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

  // Convert QuotaSnapshot to QuotaCheckResult format for display
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

    // Get unique window types
    const windowsByType = new Map<string, typeof quota.latest[0]>();
    for (const snapshot of quota.latest) {
      const existing = windowsByType.get(snapshot.windowType);
      if (!existing || snapshot.checkedAt > existing.checkedAt) {
        windowsByType.set(snapshot.windowType, snapshot);
      }
    }

    const windows = Array.from(windowsByType.values()).map(snapshot => ({
      windowType: snapshot.windowType as any,
      windowLabel: snapshot.description || snapshot.windowType,
      limit: snapshot.limit ?? undefined,
      used: snapshot.used ?? undefined,
      remaining: snapshot.remaining ?? undefined,
      utilizationPercent: snapshot.utilizationPercent ?? 0,
      unit: (snapshot.unit as any) || 'percentage',
      resetsAt: toIsoString(snapshot.resetsAt) ?? undefined,
      resetInSeconds: snapshot.resetInSeconds !== null && snapshot.resetInSeconds !== undefined ? snapshot.resetInSeconds : undefined,
      status: (snapshot.status as any) || 'ok',
    }));

    const firstSnapshot = quota.latest[0];
    const errorFromSnapshots = quota.latest.find((snapshot) => snapshot.errorMessage)?.errorMessage || undefined;
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

  // Filter for balance-type checkers (subscription window type)
  const BALANCE_CHECKERS = ['openrouter', 'minimax', 'moonshot', 'naga', 'kilo'];
  const balanceQuotas = quotas.filter(quota => {
    const checkerType = (quota.checkerType || quota.checkerId).toLowerCase();
    return BALANCE_CHECKERS.some(bc => checkerType.includes(bc));
  });

  // Filter for rate-limit checkers
  const RATE_LIMIT_CHECKERS = ['openai-codex', 'codex', 'claude-code', 'claude', 'zai', 'synthetic', 'nanogpt'];
  const rateLimitQuotas = quotas.filter(quota => {
    const checkerType = (quota.checkerType || quota.checkerId).toLowerCase();
    return RATE_LIMIT_CHECKERS.some(rc => checkerType.includes(rc));
  });

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
          <div className="flex flex-col">
            <h1 className="font-heading text-lg font-bold m-0 bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary">Plexus</h1>
            <div className="flex items-center gap-1 text-[10px] leading-none text-text-muted">
              <Tooltip content={buildMeta || `Build ${buildVersion}`} position="bottom">
                <span>{buildVersion}</span>
              </Tooltip>
              {isOutdated && (
                <Tooltip content={`Update available: ${latestVersion}`} position="bottom">
                  <span className="inline-flex text-primary" aria-label={`Outdated version. Latest is ${latestVersion}`}>
                    <AlertTriangle size={11} />
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
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
                <NavItem to="/metrics" icon={Gauge} label="Metrics" isCollapsed={isCollapsed} />
                <NavItem to="/live-metrics" icon={Zap} label="Live Metrics" isCollapsed={isCollapsed} />
                <NavItem to="/detailed-usage" icon={BarChart3} label="Detailed Usage" isCollapsed={isCollapsed} />
                <NavItem to="/usage" icon={Activity} label="Usage" isCollapsed={isCollapsed} />
                <NavItem to="/performance" icon={Gauge} label="Performance" isCollapsed={isCollapsed} />
                <NavItem to="/logs" icon={FileText} label="Logs" isCollapsed={isCollapsed} />
                <NavItem to="/quotas" icon={BarChart3} label="Quotas" isCollapsed={isCollapsed} />
              </>
            )}
        </div>

        {/* Balances Section */}
        {balanceQuotas.length > 0 && (
          <div className="mt-4 px-2">
            <button
              onClick={() => setBalancesExpanded(!balancesExpanded)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h3 className={clsx(
                "font-heading text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>Balances</h3>
              {!isCollapsed && (
                <ChevronRight
                  size={14}
                  className={clsx(
                    "text-text-muted transition-transform duration-200 group-hover:text-text",
                    balancesExpanded && "rotate-90"
                  )}
                />
              )}
            </button>
            {(balancesExpanded || isCollapsed) && (
              <div className={clsx(
                "rounded-md bg-bg-card border border-border overflow-hidden transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>
                <CompactBalancesCard
                  balanceQuotas={balanceQuotas}
                  getQuotaResult={getQuotaResult}
                />
              </div>
            )}
          </div>
        )}

        {/* Rate Limits Section */}
        {rateLimitQuotas.length > 0 && (
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
              <div className={clsx(
                "rounded-md bg-bg-card border border-border overflow-hidden transition-opacity duration-200",
                isCollapsed && "opacity-0 h-0 overflow-hidden"
              )}>
                <CompactQuotasCard
                  rateLimitQuotas={rateLimitQuotas}
                  getQuotaResult={getQuotaResult}
                />
              </div>
            )}
          </div>
        )}

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
                <NavItem to="/mcp" icon={Plug} label="MCP" isCollapsed={isCollapsed} />
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
