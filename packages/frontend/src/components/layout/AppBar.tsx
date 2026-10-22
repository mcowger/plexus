import { Menu } from 'lucide-react';
import React from 'react';

import { useSidebar } from '../../contexts/SidebarContext';
import { PlexusMark } from './PlexusMark';

export const AppBar: React.FC = () => {
  const { openMobile } = useSidebar();

  return (
    <header className="bg-bg-card border-border sticky top-0 z-[200] flex h-12 items-center gap-3 border-b px-3 md:hidden">
      <button
        type="button"
        onClick={openMobile}
        aria-label="Open navigation"
        className="text-text-secondary hover:bg-bg-hover hover:text-text duration-fast focus-visible:outline-primary -ml-2 rounded-md p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Menu size={20} />
      </button>
      <div className="flex items-center gap-2">
        <PlexusMark size={20} />
        <span className="font-heading amber-grad-text text-sm font-semibold">Plexus</span>
      </div>
    </header>
  );
};
