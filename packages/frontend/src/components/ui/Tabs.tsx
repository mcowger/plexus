import { clsx } from 'clsx';
import React from 'react';

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
        'flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] sm:gap-1 [&::-webkit-scrollbar]:hidden',
        variant === 'underline' && 'border-border-glass border-b',
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
              'font-body duration-fast focus-visible:outline-primary inline-flex flex-shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:text-sm',
              variant === 'underline' && '-mb-px border-b-2 px-3 py-2 sm:px-4 sm:py-2.5',
              variant === 'underline' && active && 'text-primary border-primary',
              variant === 'underline' &&
                !active &&
                'text-text-secondary hover:text-text border-transparent',
              variant === 'pills' && 'rounded-md px-3 py-1.5 sm:px-3.5',
              variant === 'pills' &&
                active &&
                'bg-bg-glass text-primary border-border-glass border',
              variant === 'pills' &&
                !active &&
                'text-text-secondary hover:bg-bg-hover hover:text-text'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
