import React from 'react';
import { clsx } from 'clsx';
import { Sidebar } from './Sidebar';
import { AppBar } from './AppBar';
import { Drawer } from '../ui/Drawer';
import { useSidebar } from '../../contexts/SidebarContext';

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isCollapsed, isMobileOpen, closeMobile } = useSidebar();

  return (
    // No overflow-x-clip here — the AppBar lives in this wrapper as a sticky
    // child, and clip-on-the-parent can break sticky positioning in some
    // browsers. Horizontal overflow is contained one level down on <main>.
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
          // overflow-x: clip (NOT hidden) keeps wide children from blowing out
          // the viewport on mobile WITHOUT turning <main> into a scroll
          // container — overflow-x:hidden would have done that and broken
          // every `position: sticky` page header inside.
          'min-h-screen min-w-0 overflow-x-clip transition-[margin] duration-300',
          isCollapsed ? 'md:ml-[64px]' : 'md:ml-[220px]'
        )}
      >
        {children}
      </main>
    </div>
  );
};
