import React from 'react';
import { clsx } from 'clsx';
import { Sidebar } from './Sidebar';
import { AppBar } from './AppBar';
import { Drawer } from '../ui/Drawer';
import { useSidebar } from '../../contexts/SidebarContext';

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isCollapsed, isMobileOpen, closeMobile } = useSidebar();

  return (
    <div className="min-h-screen bg-bg-deep">
      <AppBar />

      {/* Desktop fixed sidebar. Hidden below md. */}
      <Sidebar mode="desktop" />

      {/* Mobile drawer — only mounted while open. */}
      <Drawer open={isMobileOpen} onClose={closeMobile} aria-label="Main navigation">
        <Sidebar mode="drawer" />
      </Drawer>

      <main
        className={clsx(
          'min-h-screen p-4 sm:p-6 lg:p-8 transition-[margin] duration-300',
          isCollapsed ? 'md:ml-[64px]' : 'md:ml-[200px]'
        )}
      >
        {children}
      </main>
    </div>
  );
};
