import { clsx } from 'clsx';
import React from 'react';

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
        'group duration-fast relative inline-block flex-shrink-0 rounded-full border transition-colors outline-none',
        'border-border-2 bg-slate-800',
        'data-[checked=true]:from-secondary data-[checked=true]:to-primary data-[checked=true]:border-amber-500/60 data-[checked=true]:bg-gradient-to-br',
        'focus-visible:ring-primary focus-visible:ring-offset-bg-deep focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        !disabled && 'cursor-pointer',
        {
          'h-[18px] w-[30px]': size === 'sm',
          'h-5 w-[34px]': size === 'md',
        }
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'duration-fast absolute top-px left-px inline-block rounded-full bg-slate-400 transition-transform group-data-[checked=true]:bg-white',
          {
            'h-3.5 w-3.5 group-data-[checked=true]:translate-x-3': size === 'sm',
            'h-4 w-4 group-data-[checked=true]:translate-x-3.5': size === 'md',
          }
        )}
      />
    </button>
  );
};
