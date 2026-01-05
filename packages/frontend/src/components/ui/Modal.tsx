import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';

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
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center z-[1000] p-5 bg-black/70 backdrop-blur-md animate-[fadeIn_0.2s_ease]" onClick={onClose}>
      <div
        className={clsx('bg-bg-surface border border-border-glass rounded-xl max-w-full max-h-[90vh] overflow-hidden flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.5)] animate-[slideUp_0.3s_ease]', {
          'w-[400px]': size === 'sm',
          'w-[600px]': size === 'md',
          'w-[800px]': size === 'lg',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border-glass">
          <h2 className="font-heading text-xl font-semibold text-text m-0">{title}</h2>
          <button className="bg-transparent border-0 text-text-muted cursor-pointer hover:text-text" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="p-8 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 px-6 py-5 border-t border-border-glass">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
