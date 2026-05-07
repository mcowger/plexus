import React from 'react';
import { Menu } from 'lucide-react';
import { useSidebar } from '../../contexts/SidebarContext';
import { PlexusMark } from './PlexusMark';

export const AppBar: React.FC = () => {
  const { openMobile } = useSidebar();

  return (
    <header className="md:hidden sticky top-0 z-[200] h-12 flex items-center gap-3 px-3 bg-bg-card border-b border-border">
      <button
        type="button"
        onClick={openMobile}
        aria-label="Open navigation"
        className="p-2 -ml-2 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text transition-colors duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
      >
        <Menu size={20} />
      </button>
      <div className="flex items-center gap-2">
        <PlexusMark size={20} />
        <span className="font-heading text-sm font-semibold amber-grad-text">Plexus</span>
      </div>
    </header>
  );
};
