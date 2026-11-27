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
  /**
   * Below sm (640px) or on short screens (max-height 500px) the modal fills the
   * whole viewport, with safe-area insets applied to header, body and footer.
   */
  fullScreenOnMobile?: boolean;
}

// Short-screen and fullscreen rules. The sm: rules that normally pad or round the
// panel are restricted to tall screens (min-height 501px) so they never fight the
// short-screen variants (both would match at md+ landscape, e.g. 844x390).
const FULL_SCREEN_OVERLAY =
  'p-3 max-sm:p-0 [@media(max-height:500px)]:p-0 sm:[@media(min-height:501px)]:p-5';
const FULL_SCREEN_PANEL =
  'max-h-[92dvh] max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none sm:[@media(min-height:501px)]:max-h-[90dvh] sm:[@media(min-height:501px)]:rounded-2xl [@media(max-height:500px)]:h-[100dvh] [@media(max-height:500px)]:max-h-none [@media(max-height:500px)]:max-w-none [@media(max-height:500px)]:rounded-none';
const FULL_SCREEN_HEADER =
  'p-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:[@media(min-height:501px)]:p-5 [@media(max-height:500px)]:pt-[max(0.5rem,env(safe-area-inset-top))] [@media(max-height:500px)]:pb-2';
const FULL_SCREEN_BODY =
  'p-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:[@media(min-height:501px)]:p-5';
const FULL_SCREEN_FOOTER =
  'px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:[@media(min-height:501px)]:px-5 sm:[@media(min-height:501px)]:py-4 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-sm:[&>*]:flex-1 [@media(max-height:500px)]:[&>*]:flex-1';

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  fullScreenOnMobile = false,
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

  // Mobile constraints baked into this markup — keep them:
  //  * No `backdrop-filter`/`filter` anywhere in this subtree. On iOS Safari a
  //    filter on an ancestor cancels touch scrolling of the nested overflow
  //    container (WebKit bug 322849), which made long modals unscrollable.
  //    Hence the solid `bg-bg-card` panel instead of `glass-bg`.
  //  * `dvh`, not `vh`, for the max-height. Plain `vh` is the mobile *large*
  //    viewport (browser toolbars collapsed), so a vh-capped modal is taller
  //    than the visible screen and its footer lands behind the browser chrome.
  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-[410] flex animate-[fadeIn_0.2s_ease] items-center justify-center bg-black/60',
        fullScreenOnMobile ? FULL_SCREEN_OVERLAY : 'p-3 sm:p-5'
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={clsx(
          'bg-bg-card border-border-glass flex w-full animate-[slideUp_0.3s_ease] flex-col overflow-hidden rounded-xl border shadow-2xl',
          fullScreenOnMobile ? FULL_SCREEN_PANEL : 'max-h-[92dvh] sm:max-h-[90dvh] sm:rounded-2xl',
          {
            'max-w-md': size === 'sm',
            'max-w-xl': size === 'md',
            'max-w-3xl': size === 'lg',
          }
        )}
      >
        <div
          className={clsx(
            'flex shrink-0 items-center justify-between gap-3 border-b border-white/5',
            fullScreenOnMobile ? FULL_SCREEN_HEADER : 'p-4 sm:p-5'
          )}
        >
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
        <div
          className={clsx(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            fullScreenOnMobile ? FULL_SCREEN_BODY : 'p-4 sm:p-5'
          )}
        >
          {children}
        </div>
        {footer && (
          <div
            className={clsx(
              'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/5',
              fullScreenOnMobile ? FULL_SCREEN_FOOTER : 'px-4 py-3 sm:px-5 sm:py-4'
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
