import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../components/ui/Button';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  variant: ToastVariant;
  message: React.ReactNode;
  title?: React.ReactNode;
}

interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

interface ToastContextValue {
  showToast: (variant: ToastVariant, message: React.ReactNode, title?: React.ReactNode) => void;
  success: (message: React.ReactNode, title?: React.ReactNode) => void;
  error: (message: React.ReactNode, title?: React.ReactNode) => void;
  warning: (message: React.ReactNode, title?: React.ReactNode) => void;
  info: (message: React.ReactNode, title?: React.ReactNode) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const variantStyles: Record<ToastVariant, { icon: React.ReactNode; classes: string }> = {
  success: {
    icon: <CheckCircle2 size={18} className="text-success" />,
    classes: 'border-success/40',
  },
  error: {
    icon: <AlertCircle size={18} className="text-danger" />,
    classes: 'border-danger/40',
  },
  warning: {
    icon: <AlertTriangle size={18} className="text-secondary" />,
    classes: 'border-secondary/40',
  },
  info: {
    icon: <Info size={18} className="text-info" />,
    classes: 'border-info/40',
  },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, message: React.ReactNode, title?: React.ReactNode) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, variant, message, title }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success: (m, t) => showToast('success', m, t),
      error: (m, t) => showToast('error', m, t),
      warning: (m, t) => showToast('warning', m, t),
      info: (m, t) => showToast('info', m, t),
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ ...options, resolve });
        }),
    }),
    [showToast]
  );

  const resolveConfirm = (result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed top-4 right-4 z-toast flex flex-col gap-2 max-w-[90vw] sm:max-w-sm pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={clsx(
                'pointer-events-auto flex items-start gap-3 bg-bg-surface border rounded-md p-3 shadow-modal backdrop-blur-md animate-[slideUp_0.2s_ease]',
                variantStyles[toast.variant].classes
              )}
            >
              <div className="mt-0.5 flex-shrink-0">{variantStyles[toast.variant].icon}</div>
              <div className="flex-1 min-w-0">
                {toast.title && (
                  <div className="font-heading text-sm font-semibold text-text">{toast.title}</div>
                )}
                <div className="font-body text-xs text-text-secondary break-words">
                  {toast.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="flex-shrink-0 text-text-muted hover:text-text transition-colors duration-fast"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
      {confirmState &&
        createPortal(
          <div
            className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={() => resolveConfirm(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="bg-bg-surface border border-border-glass rounded-xl w-full max-w-[420px] shadow-modal animate-[slideUp_0.2s_ease]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 sm:p-6 border-b border-border-glass">
                <h2 className="font-heading text-h2 font-semibold text-text m-0">
                  {confirmState.title}
                </h2>
              </div>
              <div className="p-5 sm:p-6 font-body text-sm text-text-secondary">
                {confirmState.message}
              </div>
              <div className="flex items-center justify-end gap-3 px-5 py-4 sm:px-6 border-t border-border-glass">
                <Button variant="secondary" onClick={() => resolveConfirm(false)}>
                  {confirmState.cancelLabel ?? 'Cancel'}
                </Button>
                <Button
                  variant={confirmState.variant === 'danger' ? 'danger' : 'primary'}
                  onClick={() => resolveConfirm(true)}
                >
                  {confirmState.confirmLabel ?? 'Confirm'}
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};
