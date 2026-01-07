import React from 'react';
import { Sidebar } from './Sidebar';

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="flex min-h-screen bg-bg-deep">
      <Sidebar />
      <main className="flex-1 ml-[200px] min-h-screen p-8 transition-[margin] duration-300">
        <div className="main-content-inner">
            {children}
        </div>
      </main>
    </div>
  );
};
