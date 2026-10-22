import { clsx } from 'clsx';
import { X } from 'lucide-react';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[410] flex animate-[fadeIn_0.2s_ease] items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={clsx(
          'glass-bg flex max-h-[92vh] w-full animate-[slideUp_0.3s_ease] flex-col overflow-hidden rounded-xl shadow-2xl sm:max-h-[90vh] sm:rounded-2xl',
          {
            'max-w-md': size === 'sm',
            'max-w-xl': size === 'md',
            'max-w-3xl': size === 'lg',
          }
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/5 p-4 sm:p-5">
          <h2 className="font-heading text-text m-0 min-w-0 truncate text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            className="text-text-secondary duration-fast hover:text-text hover:bg-bg-hover focus-visible:outline-primary flex-shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 px-4 py-3 sm:px-5 sm:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
