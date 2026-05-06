import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
  /** Aria label for the off-canvas region. */
  'aria-label'?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  side = 'left',
  children,
  className,
  'aria-label': ariaLabel = 'Navigation',
}) => {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.2s_ease]"
        onClick={onClose}
      />
      <div
        className={clsx(
          // Solid background — glass-bg let underlying page content (Dashboard
          // title, page tabs) bleed through the drawer when open. Backdrop blur
          // alone isn't enough on mobile browsers.
          'absolute top-0 bottom-0 z-[310] flex bg-bg-card border-border shadow-2xl outline-none',
          side === 'left' &&
            'left-0 w-[260px] max-w-[85vw] border-r animate-[drawerSlideLeft_250ms_cubic-bezier(0.22,1,0.36,1)] flex-col',
          side === 'right' &&
            'right-0 w-full max-w-[560px] border-l animate-[drawerSlideRight_250ms_cubic-bezier(0.22,1,0.36,1)] flex-col',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
