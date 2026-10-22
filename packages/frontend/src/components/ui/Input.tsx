import { clsx } from 'clsx';
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: React.ReactNode;
  trailingAction?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  leadingIcon,
  trailingAction,
  className,
  id,
  ...props
}) => {
  const generatedId = React.useId();
  const inputId = id || props.name || generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="font-body text-text-secondary text-xs font-medium">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leadingIcon && (
          <span className="text-text-muted pointer-events-none absolute left-3 flex items-center">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={!!error}
          className={clsx(
            'font-body text-text bg-bg-glass border-border-glass duration-fast placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none transition-all outline-none',
            'hover:border-border-2',
            'focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            leadingIcon ? 'pl-9' : 'pl-3',
            trailingAction ? 'pr-10' : 'pr-3',
            error ? 'border-danger' : 'border-border',
            className
          )}
          {...props}
        />
        {trailingAction && (
          <span className="absolute right-2 flex items-center">{trailingAction}</span>
        )}
      </div>
      {error && <span className="text-danger text-xs">{error}</span>}
      {!error && hint && <span className="text-text-muted text-xs">{hint}</span>}
    </div>
  );
};
