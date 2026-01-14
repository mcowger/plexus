import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Settings,
  Server,
  Box,
  FileText,
  Bug,
  Database,
  LogOut,
  AlertTriangle,
  Key,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  Cpu,
} from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
// @ts-ignore: Ignore import error for image
import plexusLogo from '@/assets/plexus_logo_transparent.png';

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isCollapsed: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, isCollapsed }) => {
  const navLink = (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 py-1.5 px-2 rounded-md text-sm font-medium transition-all duration-200 border border-transparent hover:bg-accent hover:text-accent-foreground',
          isCollapsed && 'justify-center',
          isActive && 'bg-primary text-primary-foreground shadow-sm'
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span
        className={cn('transition-opacity duration-200', isCollapsed && 'opacity-0 w-0 overflow-hidden')}
      >
        {label}
      </span>
    </NavLink>
  );

  return isCollapsed ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{navLink}</TooltipTrigger>
        <TooltipContent side="right">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    navLink
  );
};

export const Sidebar: React.FC = () => {
  const [debugMode, setDebugMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { logout } = useAuth();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    api.getState().then(state => {
      setDebugMode(state.debug.enabled || false);
    }).catch(() => {});
  }, []);

  const handleToggleClick = () => {
    setShowConfirm(true);
  };

  const confirmToggle = async () => {
    try {
      const result = await api.updateState({
        action: 'set-debug',
        payload: { enabled: !debugMode },
      });
      setDebugMode(result.debug.enabled);
    } catch (e) {
      console.error('Failed to toggle debug mode', e);
    } finally {
      setShowConfirm(false);
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <aside
      className={cn(
        'h-screen fixed left-0 top-0 bg-card flex flex-col overflow-y-auto overflow-x-hidden z-50 transition-all duration-300 border-r border-border',
        isCollapsed ? 'w-[64px]' : 'w-[200px]'
      )}
    >
      <div className="px-4 py-6 border-b border-border flex items-center justify-between">
        <div
          className={cn(
            'flex items-center gap-3 mb-1 transition-opacity duration-200',
            isCollapsed && 'opacity-0 w-0 overflow-hidden'
          )}
        >
          <img src={plexusLogo} alt="Plexus Logo" className="w-8 h-8" />
          <h1 className="text-xl font-bold m-0 bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary">
            Plexus
          </h1>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="flex-shrink-0 h-8 w-8"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      <p
        className={cn('text-xs text-muted-foreground mt-1 px-4 transition-opacity duration-200', isCollapsed && 'opacity-0 h-0 overflow-hidden')}
      >
        AI Infrastructure Management
      </p>

      <nav className="flex-1 py-4 px-2 flex flex-col gap-6">
        <div className="flex flex-col gap-2 px-2">
          <h3
            className={cn(
              'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-opacity duration-200',
              isCollapsed && 'opacity-0 h-0 overflow-hidden'
            )}
          >
            Main
          </h3>
          <NavItem to="/" icon={LayoutDashboard} label="Dashboard" isCollapsed={isCollapsed} />
          <NavItem to="/usage" icon={Activity} label="Usage" isCollapsed={isCollapsed} />
          <NavItem to="/logs" icon={FileText} label="Logs" isCollapsed={isCollapsed} />
        </div>

        <div className="flex flex-col gap-2 px-2">
          <h3
            className={cn(
              'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 transition-opacity duration-200',
              isCollapsed && 'opacity-0 h-0 overflow-hidden'
            )}
          >
            Configuration
          </h3>
          <NavItem to="/providers" icon={Server} label="Providers" isCollapsed={isCollapsed} />
          <NavItem to="/models" icon={Box} label="Models" isCollapsed={isCollapsed} />
          <NavItem to="/keys" icon={Key} label="Keys" isCollapsed={isCollapsed} />
          <NavItem to="/system" icon={Cpu} label="System" isCollapsed={isCollapsed} />
          <NavItem to="/config" icon={Settings} label="Config" isCollapsed={isCollapsed} />
        </div>

        <div className="flex flex-col gap-2 px-2 mt-auto">
          <h3
            className={cn(
              'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-opacity duration-200',
              isCollapsed && 'opacity-0 h-0 overflow-hidden'
            )}
          >
            System
          </h3>
          {(() => {
            const debugButton = (
              <Button
                variant={debugMode ? 'destructive' : 'ghost'}
                className={cn(
                  'flex items-center gap-3 w-full justify-start py-1.5 px-2 rounded-md text-sm font-medium transition-all duration-200 border border-transparent hover:bg-accent hover:text-accent-foreground h-8',
                  isCollapsed && 'justify-center',
                  debugMode && 'border-destructive/30 bg-destructive text-destructive-foreground shadow-sm'
                )}
                onClick={handleToggleClick}
              >
                <Bug className="h-4 w-4" />
                <span
                  className={cn('transition-opacity duration-200', isCollapsed && 'opacity-0 w-0 overflow-hidden')}
                >
                  {debugMode ? 'Debug Mode: On' : 'Debug Mode: Off'}
                </span>
              </Button>
            );

            return isCollapsed ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>{debugButton}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{debugMode ? 'Debug Mode: On' : 'Debug Mode: Off'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              debugButton
            );
          })()}
          <NavItem to="/debug" icon={Database} label="Debug Traces" isCollapsed={isCollapsed} />
          <NavItem to="/errors" icon={AlertTriangle} label="Errors" isCollapsed={isCollapsed} />
          {(() => {
            const themeButton = (
              <Button
                variant="ghost"
                className={cn(
                  'flex items-center gap-3 w-full justify-start py-1.5 px-2 rounded-md text-sm font-medium transition-all duration-200 border border-transparent hover:bg-accent hover:text-accent-foreground h-8',
                  isCollapsed && 'justify-center'
                )}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span
                  className={cn('transition-opacity duration-200', isCollapsed && 'opacity-0 w-0 overflow-hidden')}
                >
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </span>
              </Button>
            );

            return isCollapsed ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>{themeButton}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              themeButton
            );
          })()}
          {(() => {
            const logoutButton = (
              <Button
                variant="ghost"
                className={cn(
                  'flex items-center gap-3 w-full justify-start py-1.5 px-2 rounded-md text-sm font-medium transition-all duration-200 border border-transparent hover:bg-accent hover:text-destructive text-destructive h-8',
                  isCollapsed && 'justify-center'
                )}
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
                <span
                  className={cn('transition-opacity duration-200', isCollapsed && 'opacity-0 w-0 overflow-hidden')}
                >
                  Logout
                </span>
              </Button>
            );

            return isCollapsed ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>{logoutButton}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Logout</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              logoutButton
            );
          })()}
        </div>
      </nav>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{debugMode ? 'Disable Debug Mode?' : 'Enable Debug Mode?'}</DialogTitle>
            <DialogDescription>
              {debugMode
                ? 'Disabling debug mode will stop capturing full request/response payloads.'
                : 'Enabling debug mode will capture FULL raw request and response payloads, including personal data if present. This can consume significant storage.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button variant={debugMode ? 'default' : 'destructive'} onClick={confirmToggle}>
              {debugMode ? 'Disable' : 'Enable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
};
