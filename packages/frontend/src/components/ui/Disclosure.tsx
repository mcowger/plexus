import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

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
    <div className={clsx('border border-border-glass rounded-md bg-bg-glass/50 overflow-hidden', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:-outline-offset-2"
      >
        <ChevronRight
          size={14}
          className={clsx(
            'text-text-muted flex-shrink-0 transition-transform duration-fast',
            open && 'rotate-90'
          )}
        />
        <span className="flex-1 font-heading text-sm font-medium text-text">{title}</span>
        {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-border-glass animate-[fadeIn_0.15s_ease]">
          {children}
        </div>
      )}
    </div>
  );
};
