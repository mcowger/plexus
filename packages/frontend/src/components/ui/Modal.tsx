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
      className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-5 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={clsx(
          'glass-bg rounded-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-[slideUp_0.3s_ease]',
          {
            'max-w-md': size === 'sm',
            'max-w-xl': size === 'md',
            'max-w-3xl': size === 'lg',
          }
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 p-5 border-b border-white/5">
          <h2 className="font-heading text-base font-semibold text-text m-0 truncate">{title}</h2>
          <button
            type="button"
            className="flex-shrink-0 bg-transparent border-0 text-text-secondary cursor-pointer rounded-md p-1.5 transition-colors duration-fast hover:text-text hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-white/5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
