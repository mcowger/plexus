import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import React, { useState } from 'react';

interface DisclosureProps {
  title: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Disclosure: React.FC<DisclosureProps> = ({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  extra,
  children,
  className,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={clsx('border-border bg-bg-card overflow-hidden rounded-lg border', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="duration-fast hover:bg-bg-hover focus-visible:outline-primary flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <ChevronRight
          size={14}
          className={clsx(
            'text-text-muted duration-fast flex-shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        />
        {/* `flex-wrap` on the header + `min-w-0` here: actions passed via
            `extra` (Refresh / Restart / Export, etc.) otherwise overflow a
            phone-width card, and the card clips them out of reach. */}
        <span className="font-heading text-text min-w-0 flex-1 text-sm font-medium">{title}</span>
        {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
      </button>
      {open && (
        <div className="border-border-glass animate-[fadeIn_0.15s_ease] border-t px-4 pt-2 pb-4">
          {children}
        </div>
      )}
    </div>
  );
};
