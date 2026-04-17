import React from 'react';
import { Menu } from 'lucide-react';
import { useSidebar } from '../../contexts/SidebarContext';
import logo from '../../assets/plexus_logo_transparent.png';

export const AppBar: React.FC = () => {
  const { openMobile } = useSidebar();

  return (
    <header className="md:hidden sticky top-0 z-sidebar h-14 flex items-center gap-3 px-4 bg-bg-surface/90 backdrop-blur-md border-b border-border">
      <button
        type="button"
        onClick={openMobile}
        aria-label="Open navigation"
        className="p-2 -ml-2 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text transition-colors duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
      >
        <Menu size={22} />
      </button>
      <div className="flex items-center gap-2">
        <img src={logo} alt="" className="w-6 h-6" />
        <span className="font-heading text-lg font-bold bg-clip-text text-transparent bg-gradient-to-br from-primary to-secondary">
          Plexus
        </span>
      </div>
    </header>
  );
};
