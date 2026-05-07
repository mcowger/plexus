import React from 'react';
import { clsx } from 'clsx';

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
        <label htmlFor={inputId} className="font-body text-xs font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-3 flex items-center text-text-muted">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={!!error}
          className={clsx(
            'w-full py-2 font-body text-sm text-text bg-slate-900/60 border rounded-md outline-none transition-all duration-fast placeholder:text-text-muted',
            'hover:border-border-2',
            'focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
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
