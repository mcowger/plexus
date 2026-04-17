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
    <div
      className="fixed inset-0 z-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-[fadeIn_0.2s_ease]"
        onClick={onClose}
      />
      <div
        className={clsx(
          'absolute top-0 bottom-0 z-drawer flex w-[280px] max-w-[85vw] flex-col bg-bg-surface border-border shadow-modal outline-none',
          side === 'left' &&
            'left-0 border-r animate-[drawerSlideLeft_250ms_cubic-bezier(0.22,1,0.36,1)]',
          side === 'right' &&
            'right-0 border-l animate-[drawerSlideRight_250ms_cubic-bezier(0.22,1,0.36,1)]',
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
