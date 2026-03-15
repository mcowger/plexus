import React from 'react';
import { clsx } from 'clsx';
import { Sidebar } from './Sidebar';
import { useSidebar } from '../../contexts/SidebarContext';

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    <div className="flex min-h-screen bg-bg-deep">
      <Sidebar />
      <main
        className={clsx(
          'flex-1 min-h-screen p-4 md:p-6 lg:p-8 transition-[margin] duration-300 overflow-x-hidden',
          isCollapsed ? 'ml-[64px]' : 'ml-[clamp(64px,15vw,200px)]'
        )}
      >
        <div className="main-content-inner w-full">{children}</div>
      </main>
    </div>
  );
};
