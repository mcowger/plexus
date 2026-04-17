import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface SidebarContextType {
  /** Desktop collapsed state (icon-only rail). Persisted to localStorage. */
  isCollapsed: boolean;
  toggleSidebar: () => void;
  /** Mobile drawer open state. Ephemeral — not persisted. */
  isMobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem('plexus_sidebar_collapsed');
    if (stored !== null) {
      setIsCollapsed(stored === 'true');
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev) => {
      const newState = !prev;
      localStorage.setItem('plexus_sidebar_collapsed', String(newState));
      return newState;
    });
  }, []);

  const openMobile = useCallback(() => setIsMobileOpen(true), []);
  const closeMobile = useCallback(() => setIsMobileOpen(false), []);

  return (
    <SidebarContext.Provider
      value={{ isCollapsed, toggleSidebar, isMobileOpen, openMobile, closeMobile }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};
