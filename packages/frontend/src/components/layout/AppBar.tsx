import React from 'react';
import { Menu } from 'lucide-react';
import { useSidebar } from '../../contexts/SidebarContext';
import { useAuth } from '../../contexts/AuthContext';
import { PlexusMark } from './PlexusMark';

export const AppBar: React.FC = () => {
  const { openMobile } = useSidebar();
  const { principal } = useAuth();

  const initials = principal?.role === 'admin'
    ? 'AD'
    : (principal?.keyName || 'KU').slice(0, 2).toUpperCase();

  return (
    <header className="md:hidden sticky top-0 z-sidebar h-14 flex items-center gap-3 px-4 glass-bg border-b border-white/5">
      <button
        type="button"
        onClick={openMobile}
        aria-label="Open navigation"
        className="p-2 -ml-2 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text transition-colors duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
      >
        <Menu size={22} />
      </button>
      <div className="flex items-center gap-2">
        <PlexusMark size={22} />
        <span className="font-heading text-base font-semibold amber-grad-text">Plexus</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="w-7 h-7 rounded-full amber-grad-bg grid place-items-center text-[10px] font-semibold text-amber-950">
          {initials}
        </div>
      </div>
    </header>
  );
};
