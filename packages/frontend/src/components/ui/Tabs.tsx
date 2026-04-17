import React from 'react';
import { clsx } from 'clsx';

interface TabItem<V extends string = string> {
  value: V;
  label: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  items: TabItem<V>[];
  variant?: 'underline' | 'pills';
  className?: string;
  'aria-label'?: string;
}

export function Tabs<V extends string = string>({
  value,
  onChange,
  items,
  variant = 'underline',
  className,
  'aria-label': ariaLabel,
}: TabsProps<V>) {
  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const enabled = items.filter((i) => !i.disabled);
    const currentEnabledIdx = enabled.findIndex((i) => i.value === items[idx]?.value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = enabled[(currentEnabledIdx + 1) % enabled.length];
      if (next) onChange(next.value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = enabled[(currentEnabledIdx - 1 + enabled.length) % enabled.length];
      if (prev) onChange(prev.value);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx(
        'flex items-center gap-1 overflow-x-auto',
        variant === 'underline' && 'border-b border-border-glass',
        className
      )}
    >
      {items.map((item, idx) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            aria-disabled={item.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => !item.disabled && onChange(item.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            disabled={item.disabled}
            className={clsx(
              'flex-shrink-0 inline-flex items-center gap-2 font-body text-sm font-medium transition-all duration-fast whitespace-nowrap focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed',
              variant === 'underline' && 'px-4 py-2.5 border-b-2 -mb-px',
              variant === 'underline' && active && 'text-primary border-primary',
              variant === 'underline' && !active && 'text-text-secondary border-transparent hover:text-text',
              variant === 'pills' && 'px-3.5 py-1.5 rounded-md',
              variant === 'pills' && active && 'bg-bg-glass text-primary border border-border-glass',
              variant === 'pills' && !active && 'text-text-secondary hover:bg-bg-hover hover:text-text'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
