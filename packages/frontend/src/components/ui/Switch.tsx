import React from 'react';
import { clsx } from 'clsx';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled,
  size = 'md',
  'aria-label': ariaLabel,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={clsx(
        'group relative inline-block flex-shrink-0 rounded-full border border-border-glass bg-border transition-colors duration-fast outline-none',
        'data-[checked=true]:bg-success data-[checked=true]:border-transparent',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        !disabled && 'cursor-pointer',
        {
          'h-[18px] w-8': size === 'sm',
          'h-6 w-11': size === 'md',
        }
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'absolute left-0.5 top-0.5 inline-block rounded-full bg-white shadow-sm transition-transform duration-fast',
          {
            'h-3.5 w-3.5 group-data-[checked=true]:translate-x-[14px]': size === 'sm',
            'h-5 w-5 group-data-[checked=true]:translate-x-5': size === 'md',
          }
        )}
      />
    </button>
  );
};
