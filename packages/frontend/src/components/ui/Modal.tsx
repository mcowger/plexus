import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
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
      className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-5 bg-black/70 backdrop-blur-md animate-[fadeIn_0.2s_ease]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={clsx(
          'bg-bg-surface border border-border-glass rounded-xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-modal animate-[slideUp_0.3s_ease]',
          {
            'max-w-[420px]': size === 'sm',
            'max-w-[640px]': size === 'md',
            'max-w-[960px]': size === 'lg',
          }
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 p-4 sm:p-5 md:p-6 border-b border-border-glass">
          <h2 className="font-heading text-h2 font-semibold text-text m-0 truncate">{title}</h2>
          <button
            type="button"
            className="flex-shrink-0 bg-transparent border-0 text-text-muted cursor-pointer rounded-md p-1 transition-colors duration-fast hover:text-text focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 sm:p-5 md:p-6 lg:p-8 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-4 sm:px-5 sm:py-5 md:px-6 border-t border-border-glass">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
